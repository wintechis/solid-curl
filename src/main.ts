import { Session } from '@inrupt/solid-client-authn-node';
import process from 'process';
import { program } from 'commander';
import { createReadStream } from 'fs';
import logger from 'loglevel';
import { Writable } from 'stream';
import { deletePassword, findCredentials, getPassword, setPassword } from 'keytar';
import { question } from 'readline-sync';;
import { Parser, Quad, Store, DataFactory } from 'n3';
import { printTable } from 'console-table-printer';
import { lookup } from 'mime-types';

const { namedNode } = DataFactory;

const version = '0.1.10';

// Remove draft warning from oidc-client lib
process.emitWarning = (warning: any, ...args: any) => {
	if (args[0] === 'DraftWarning') {
		return;
	}
	return process.emitWarning(warning, ...args);
};

// Command line arguments
program
	.version(version, '-V, --version', 'Show version number and quit')
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
	.option('-u, --user <identity>', 'Use stored identity')
	.option('-u, -- <identity>', 'Use stored identity')
	//.option('-A, --user-agent <name>', 'Send User-Agent <name> to server')
	.option('-v, --verbose', 'Make the operation more talkative')
	.option('-X, --request <method>', 'Specify custom request method')
	.action(run);
	
program
	.command('register-user')
	.argument('<uri>', 'WebID')
	.action(registerUser);
	
program
	.command('delete-user')
	.argument('<identity>', 'Identity name')
	.action(deleteUser);

program
	.command('list-users')
	.action(listUsers);

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
		'user-agent': 'solid-curl/' + version,
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
		(fetchInit as RequestInit & { duplex: string })['duplex'] = 'half';
		// Default method with data is POST
		fetchInit['method'] = 'POST';
		// Determine MIME type (can be overwritten by the user), default text/turtle
		headers['content-type'] = lookup(options.data.substring(1)) || 'text/turtle';
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

	// Get credentials from storage
	let credentials = await findCredentials('solid-curl');
	if(!credentials.some(c => c.account === user)) {
		logger.error('No credentials with name \'' + user + '\' found!');
		process.exit(1);
	}
	let creds = JSON.parse(credentials.find(c => c.account === user)!.password);

	// Log in
	let oidcIssuer = creds['oidcIssuer'];
	logger.info(`* Initiating OIDC login at ${oidcIssuer}`);
	await session.login({
		oidcIssuer: oidcIssuer,
		clientId: creds['id'],
		clientSecret: creds['secret']
	});

	await doFetch(uri, fetchInit, headers, session, process.stdout, options?.include);
	process.exit();
}

async function listUsers() {
	let credentials = await findCredentials('solid-curl');
	let prettyCredentials = credentials.map(c => {
		let creds = JSON.parse(c.password);
		return {
			Identity: c.account,
			WebID: creds['webId'],
			'OIDC Issuer': creds['oidcIssuer'],
			ClientID: creds['id']
		};
	});
	printTable(prettyCredentials);
}

async function registerUser(webId: string) {
	let oidcIssuer = await getOIDCIssuer(webId);
	let credentials = await registerApp(oidcIssuer);
	console.log('Successfully created credentials!')
	let identity = question('Identity name: ')
	setPassword('solid-curl', identity, JSON.stringify({
		webId: webId,
		oidcIssuer: oidcIssuer,
		id: credentials.id,
		secret: credentials.secret
	}));
}

async function deleteUser(identity: string) {
	let creds = await getPassword('solid-curl', identity);
	if(creds == null) {
		throw Error('Identity "' + identity + '" not found!');
	}
	let credsParsed = JSON.parse(creds);
	let oidcIssuer = credsParsed['oidcIssuer'];
	let clientId = credsParsed['id'];

	await deregisterApp(oidcIssuer, clientId);
	deletePassword('solid-curl', identity);
}

interface ClientCredentials {
	id: string,
	secret: string
}

async function registerApp(oidcIssuer: string): Promise<ClientCredentials> {
	// Try Community Solid Server
	let response = await fetch(oidcIssuer + 'idp/credentials/')
	if(response.status == 405) {
		console.log('Authenticating with ' + oidcIssuer + ' (Community Solid Server):');
		let email = question('E-Mail: ');
		let password = question('Password: ', {
			hideEchoBack: true
		});

		response = await fetch(oidcIssuer + 'idp/credentials/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				email: email,
				password: password,
				name: 'solid-curl'
			})
		});
		
		if(response.status == 200) {
			return await response.json();
		} else {
			throw Error(await response.text());
		}
	}

	throw Error('No client registration could be found for the OIDC issuer!');
}

async function deregisterApp(oidcIssuer: string, clientId: string) {
	// Try Community Solid Server
	let response = await fetch(oidcIssuer + 'idp/credentials/')
	if(response.status == 405) {
		console.log('Authenticating with ' + oidcIssuer + ' (Community Solid Server):');
		let email = question('E-Mail: ');
		let password = question('Password: ', {
			hideEchoBack: true
		});

		response = await fetch(oidcIssuer + 'idp/credentials/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				email: email,
				password: password,
				delete: clientId
			})
		});
		
		if(response.status == 200) {
			return await response.json();
		} else {
			throw Error(await response.text());
		}
	}

	throw Error('No client registration could be found for the OIDC issuer!');
}

async function getOIDCIssuer(webId: string): Promise<string> {
	let response = await fetch(webId);
	let quads = await parseResponse(response);
	let store = new Store();
	store.addQuads(quads);
	let issuers = store.getObjects(namedNode(webId), namedNode('http://www.w3.org/ns/solid/terms#oidcIssuer'), null);

	if(issuers.length > 0) {
		return issuers[0].value;
	} else {
		throw Error('No OIDC issuer in Profile Document found!');
	}
}

async function parseResponse(response: Response): Promise<Quad[]> {
	return new Promise(async (resolve, reject) => {
		let quads: Quad[] = [];
		let parser = new Parser({
			baseIRI: response.url
		});
		let text: string = await response.text();
		
		parser.parse(text, (error, quad) => {
			if(error) {
				reject(error);
			}
			if(quad) {
				quads.push(quad);
			} else {
				resolve(quads);
			}
		});
	});
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
					outStream.write(`${'\x1b[1m'}${h[0].split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join('-')}${'\x1b[0m'}: ${h[1]}\n`);
				}
			}
			if(include) {
				outStream.write(`\n`);
			}
			logger.info('<');
			let buffer = Buffer.from(await res.arrayBuffer())
			outStream.write(buffer);
		}
		catch(error: any) {
			if(error['errno'] === 'ENOTFOUND') {
				logger.error(`Could not resolve host: ${uri.split('/').slice(2,3).join()}`)
			} else if(error['errno'] === 'ECONNREFUSED') {
				logger.error(`Connection refused: ${uri.split('/').slice(2,3).join()}`)
			} else {
				logger.error(error);
			}
		}
}
