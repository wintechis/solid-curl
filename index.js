const express = require("express");
const { Session } = require("@inrupt/solid-client-authn-node");
const puppeteer = require('puppeteer');
const process = require('process');
const readlineSync = require('readline-sync');

// Remove draft warning from oidc-client lib
process.emitWarning = (warning, ...args) => {
	if (args[0] === 'DraftWarning') {
		return;
	}
	return emitWarning(warning, ...args);
};

const session = new Session();

// Try request without authentication
session.fetch(process.argv[2], {
	method: 'HEAD',
}).then(async res => {
	if(res.status !== 401) {
		// No 401 Unauthenticated so do real request and exit
		session.fetch(process.argv[2]).then(async res => {
			let text = await res.text();
			console.log(text);
			process.exit();
		});
	}
});
// Else authenticate

const app = express();
let server = null;

// Handler for the redirect from the IdP
app.get("/", async (req, res, next) => {
	await session.handleIncomingRedirect(`http://localhost:8988${req.url}`);
	res.sendStatus(200);

	// Do actual request
	session.fetch(process.argv[2]).then(async res => {
		let text = await res.text();
		console.log(text);
		process.exit();
	});
});
server = app.listen(8988);

// Try to load credentials from config
let config = null;
try {
	config = require('./.solid-curl-config.json');
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
        throw e;
    }
}
const {
	oidcProvider: configOidcProvider,
	email: configEmail,
	username: configUsername,
	password: configPassword,
} = config;

// Log in
let oidcIssuer = configOidcProvider ? configOidcProvider : readlineSync.question(`Solid OIDC Provider URI: `);
session.login({
	redirectUrl: 'http://localhost:8988/',
	oidcIssuer: oidcIssuer,
	handleRedirect: handleRedirect,
})

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
		new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
	]);
	await page.click('button[type=submit]');
	let res = await resP;

	if(res === null) {
		await page.screenshot({ path: 'example.png' });
		console.error('Authentication did not succeed!');
		process.exit(1);
	} else {
		// node-solid-server may redirect to another form that needs a submit
		if(res.status() !== 200) {
			console.error('Authentication did not succeed!');
			process.exit(1);
		} else {
			let submit = await page.$('button[type=submit]')
			if(submit) {
				await page.click('button[type=submit]');
			}
		}
	}
	await browser.close();
}
