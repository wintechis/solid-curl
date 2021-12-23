import express from 'express';
import { Session } from '@inrupt/solid-client-authn-node';
import puppeteer, { HTTPResponse } from 'puppeteer';
import process from 'process';
import { program } from 'commander';
import { createReadStream } from 'fs';
import logger, { debug } from 'loglevel';
import { Writable } from 'stream';

// Remove draft warning from oidc-client lib
process.emitWarning = (warning: any, ...args: any) => {
	if (args[0] === 'DraftWarning') {
		return;
	}
	return process.emitWarning(warning, ...args);
};

// Command line arguments
program
	.version('0.1.0', '-V, --version', 'Show version number and quit')
	.argument('<uri>', 'Target URI')
	.option('-d, --data <data>', 'HTTP POST data')
	//.option('-f, --fail', 'Fail silently (no output at all) on HTTP errors')
	.option('-H, --header <header...>', 'Add header to request')
	.option('-i, --include', 'Include HTTP response headers in output')
	.option('-L, --location', 'Follow redirects')
	//.option('-o, --output <file>', 'Write to file instead of stdout')
	//.option('-O, --remote-name', 'Write output to a file named as the remote file')
	.option('-s, --silent', 'Silent mode')
	//.option('-T, --transfer-file <file>', 'Transfer local FILE to destination')
	.option('-u, --user <identity>', 'Use identity from config file')
	//.option('-A, --user-agent <name>', 'Send User-Agent <name> to server')
	.option('-v, --verbose', 'Make the operation more talkative')
	.option('-X, --request <method>', 'Specify custom request method', 'GET')
	.action(run);

program.parseAsync();

async function run(uri: string, options: any) {
	if(options.verbose) {
		logger.setLevel('info');
	}
	if(options.silent) {
		logger.setLevel('silent');
	}

	const session = new Session();
	let headers: Record<string,string> = {
		'accept': 'text/turtle, */*;q=0.8',
		'user-agent': 'solid-curl/0.1.0',
		'accept-encoding': 'gzip,deflate',
		'connection': 'close',
		'host': uri.split('/').slice(2,3).join()
	};
	let fetchInit: RequestInit = {
		redirect: options.location ? 'follow' : 'manual'
	};

	// Loading data from file if necessary
	let data = options.data?.startsWith('@') ? createReadStream(options.data.substring(1)) : options.data;
	if(data) {
		fetchInit['body'] = data;
		// Default method with data is POST
		fetchInit['method'] = 'POST';
		// Default Content-Type is text/turtle but can be overriden later
		headers['content-type'] = 'text/turtle';
	}

	// Setting method
	if(options.request) {
		fetchInit['method'] = options.request;
	}

	// Transforming headers into format needed by fetch
	for(let h of options?.header || []) {
		let split = h.split(':')
		headers[split[0].toLowerCase()] = split.slice(1).join().trim();
	}
	fetchInit['headers'] = headers;

	const user = options.user;
	// Do unauthenticated request when no user is provided
	if(!user) {
		logger.info('* No user identity given, doing unauthenticated request');
		await doFetch(uri, fetchInit, headers, session, process.stdout, options?.include);
		process.exit();
	}

	const app = express();
	let server = null;

	// Handler for the redirect from the IdP
	app.get("/", async (req, expressRes) => {
		logger.info(`* Received redirect from IdP to: ${req.url}`);
		await session.handleIncomingRedirect(`http://localhost:29884${req.url}`);
		expressRes.sendStatus(200);

		logger.info(`* Doing actual request authenticated as ${session.info.webId}`);
		await doFetch(uri, fetchInit, headers, session, process.stdout, options?.include);
		process.exit();
	});
	server = app.listen(29884);

	// Try to load credentials from config
	const config = require('../.solid-curl-ids.json');
	const {
		oidcProvider: configOidcProvider,
		email: configEmail,
		username: configUsername,
		password: configPassword,
	} = config[options.user];
	logger.info(`* Loaded credentials of identity ${options.user} from config file`);

	// Log in
	let oidcIssuer = configOidcProvider// ? configOidcProvider : readlineSync.question(`Solid OIDC Provider URI: `);
	logger.info(`* Initiating OIDC login at ${oidcIssuer}`);
	await session.login({
		redirectUrl: 'http://localhost:29884/',
		oidcIssuer: oidcIssuer,
		handleRedirect: handleRedirect,
	});
		/*
	} catch (e) {
		if (e.code !== 'MODULE_NOT_FOUND') {
			throw e;
		}
	}
	*/

	// Redirect Handler: Fill out the login form
	async function handleRedirect(url: string) {
		const browser = await puppeteer.launch();
		const page = await browser.newPage();
		logger.info(`* Fetching login page provided by IdP: ${url}`);
		await page.goto(url);

		let emailField = await page.$('#email');
		if(emailField) {
			let email = configEmail// ? configEmail : readlineSync.question(`${emailLabel}: `);
			logger.info(`* Entering email to form: ${email}`);
			await emailField.type(email);
		}

		let usernameField = await page.$('#username') || await page.$('#signInFormUsername');
		if(usernameField) {
			let username = configUsername// ? configUsername : readlineSync.question(`${usernameLabel}: `);
			logger.info(`* Entering username to form: ${username}`);
			await usernameField.type(username);
		}

		let passwordField = await page.$('#password') || await page.$('#signInFormPassword');
		if(passwordField) {
			let password = configPassword// ? configPassword : readlineSync.question(`${passwordLabel}: `, {
			//	hideEchoBack: true,
			//});
			logger.info(`* Entering password to form: ${password.replaceAll(new RegExp('.', 'g'), '*')}`);
			await passwordField.type(password);
		}

		let resP = Promise.race([
			page.waitForNavigation(),
			new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
		]);
		let submit = await page.$('button[type=submit]') || await page.$('input[type=Submit]'); 
		logger.info(`* Submitting login form`);
		await submit?.click();
		let res = await resP;

		if(res === null) {
			logger.error('Authentication did not succeed: Timed out!');
			process.exit(1);
		} else {
			// node-solid-server may redirect to another form that needs a submit
			if((res as HTTPResponse).status() !== 200) {
				logger.error(`Authentication did not succeed: ${(res as HTTPResponse).status()} ${(res as HTTPResponse).statusText()}`);
				process.exit(2);
			} else {
				let submit = await page.$('button[type=submit]') || await page.$('button[form=approve]');
				if(submit) {
					logger.info(`* Pressing button to allow our application`);
					submit.click();
					await page.waitForNavigation();
				}
			}
		}
		await browser.close();
	}
}

async function doFetch(uri: string, fetchInit: RequestInit, headers: Record<string,string>, session: Session, outStream: Writable, include: boolean) {
		// Do actual request
		logger.info(`> ${fetchInit.method} /${uri.split('/').slice(3).join('/')} HTTP/1.1`);
		for(let h in headers) {
			// Make header names upercase for logging
			logger.info(`> ${h.split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join('-')}: ${headers[h]}`);
		}
		// If request was authenticated, add placeholder for DPoP
		if(session.info.isLoggedIn) {
			logger.info(`> Authorization: DPoP [omitted]`);
		}
		logger.info('>');
		try {
			let res = await session.fetch(uri, fetchInit);
			logger.info(`< HTTP/1.1 ${res.status} ${res.statusText}`);
			if(include) {
				outStream.write(`HTTP/1.1 ${res.status} ${res.statusText}\n`);
			}
			for(let h of res.headers) {
				logger.info(`< ${h[0].split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join('-')}: ${h[1]}`);
				if(include) {
					outStream.write(`${'\033[1m'}${h[0].split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join('-')}${'\033[0m'}: ${h[1]}\n`);
				}
			}
			if(include) {
				outStream.write(`\n`);
			}
			logger.info('<');
			let text = await res.text();
			outStream.write(text);
		}
		catch(error: any) {
			if(error['errno'] === 'ENOTFOUND') {
				logger.error(`Could not resolve host: ${uri.split('/').slice(2,3).join()}`)
			} else if(error['errno'] === 'ECONNREFUSED') {
				logger.error(`Connection refused: ${uri.split('/').slice(2,3).join()}`)
			}
		}
}