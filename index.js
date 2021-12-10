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

// Log in
let oidcIssuer = readlineSync.question(`Solid OIDC Provider URI: `);
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
		let email = readlineSync.question(`${emailLabel}: `);
		await emailField.type(email);
	}

	let passwordField = await page.$('#password');
	if(passwordField) {
		let passwordLabel = await page.$eval('label[for=password]', el => el.innerHTML);
		let password = readlineSync.question(`${passwordLabel}: `, {
			hideEchoBack: true,
		});
		await passwordField.type(password);
	}
	process.stdout.write('\n');

	let res = Promise.race([
		page.waitForResponse(),
		new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
	]);
	page.click('button[type=submit]');

	if(await res === null) {
		console.error('Authentication did not succeed!');
		process.exit(1);
	}
	await browser.close();
}
