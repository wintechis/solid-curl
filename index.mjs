import express from 'express';
import { Session } from '@inrupt/solid-client-authn-node';
import puppeteer from 'puppeteer';
import process from 'process';
import readlineSync from 'readline-sync';
import { program } from 'commander';
import { createReadStream } from 'fs';
import logger from 'loglevel';

// Remove draft warning from oidc-client lib
process.emitWarning = (warning, ...args) => {
	if (args[0] === 'DraftWarning') {
		return;
	}
	return emitWarning(warning, ...args);
};

// Command line arguments
program
	.version('0.1.0', '-V, --version', 'Show version number and quit')
	.argument('<uri>', 'Target URI')
	.option('-d, --data <data>', 'HTTP POST data')
	.option('-f, --fail', 'Fail silently (no output at all) on HTTP errors')
	.option('-H, --header <header...>', 'Add header to request', [])
	.option('-i, --include', 'Include HTTP response headers in output')
	.option('-o, --output <file>', 'Write to file instead of stdout')
	.option('-O, --remote-name', 'Write output to a file named as the remote file')
	.option('-s, --silent', 'Silent mode')
	.option('-T, --transfer-file <file>', 'Transfer local FILE to destination')
	.option('-u, --user <identity>', 'Use identity from config file')
	.option('-A, --user-agent <name>', 'Send User-Agent <name> to server')
	.option('-v, --verbose', 'Make the operation more talkative')
	.option('-X, --request <method>', 'Specify custom request method', 'GET')
	.action(run);

program.parseAsync();

async function run(uri, options) {
	const session = new Session();
	let headers = {};
	let fetchInit = {
		method: options.method
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

	// Transforming headers into format needed by fetch
	for(let h of options.header) {
		let split = h.split(':')
		headers[split[0].toLowerCase()] = split.slice(1).join().trim();
	}
	fetchInit['headers'] = headers;

	const user = options.user;
	// Do unauthenticated request when no user is provided
	if(!user) {
		logger.info('* No user identity given, doing unauthenticated request');
		const res = await session.fetch(uri, fetchInit);
		const text = await res.text();
		console.log(text);
		process.exit();
	}

	const app = express();
	let server = null;

	// Handler for the redirect from the IdP
	app.get("/", async (req, res) => {
		await session.handleIncomingRedirect(`http://localhost:29884${req.url}`);
		res.sendStatus(200);

		// Do actual request
		session.fetch(uri, fetchInit).then(async res => {
			let text = await res.text();
			console.log(text);
			process.exit();
		});
	});
	server = app.listen(29884);

	// Try to load credentials from config
	const config = require('./.solid-curl-ids.json');
	const {
		oidcProvider: configOidcProvider,
		email: configEmail,
		username: configUsername,
		password: configPassword,
	} = config[options.user];

	// Log in
	let oidcIssuer = configOidcProvider ? configOidcProvider : readlineSync.question(`Solid OIDC Provider URI: `);
	session.login({
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
	async function handleRedirect(url) {
		const browser = await puppeteer.launch();
		const page = await browser.newPage();
		await page.goto(url);

		let emailField = await page.$('#email');
		if(emailField) {
			let emailLabel = await page.$eval('label[for=email]', el => el.innerHTML);
			let email = configEmail ? configEmail : readlineSync.question(`${emailLabel}: `);
			await emailField.type(email);
		}

		let usernameField = await page.$('#username');
		if(usernameField) {
			let usernameLabel = await page.$eval('label[for=username]', el => el.innerHTML);
			let username = configUsername ? configUsername : readlineSync.question(`${usernameLabel}: `);
			await usernameField.type(username);
		}

		let passwordField = await page.$('#password');
		if(passwordField) {
			let passwordLabel = await page.$eval('label[for=password]', el => el.innerHTML);
			let password = configPassword ? configPassword : readlineSync.question(`${passwordLabel}: `, {
				hideEchoBack: true,
			});
			await passwordField.type(password);
		}

		let resP = Promise.race([
			page.waitForNavigation(),
			new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
		]);
		await page.click('button[type=submit]');
		let res = await resP;

		if(res === null) {
			await page.screenshot({ path: 'example.png' });
			logger.error('Authentication did not succeed!');
			process.exit(1);
		} else {
			// node-solid-server may redirect to another form that needs a submit
			if(res.status() !== 200) {
				await page.screenshot({ path: 'example.png' });
				logger.error('Authentication did not succeed!');
				process.exit(2);
			} else {
				let submit = await page.$('button[type=submit]')
				if(submit) {
					await page.click('button[type=submit]');
				}
			}
		}
		await browser.close();
	}
}
