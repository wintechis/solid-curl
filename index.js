const express = require("express");
const { 
  getSessionFromStorage,
  getSessionIdFromStorageAll,
  Session
} = require("@inrupt/solid-client-authn-node");
const open = require('open');
//const fetch = require('node-fetch');
//const superagent = require('superagent');
const puppeteer = require('puppeteer');
const https = require('https');
//const { JSDOM } = require('jsdom');
//const { createHttpTerminator } = require('http-terminator');
const process = require('process');

process.emitWarning = (warning, ...args) => {
	if (args[0] === 'DraftWarning') {
		return;
	}

	return emitWarning(warning, ...args);
};

const session = new Session();
const app = express();

const httpAgent = new https.Agent({
	keepAlive: true
});

let prom = null;
let server = null;

app.get("/", async (req, res, next) => {
	await session.handleIncomingRedirect(`http://localhost:8988${req.url}`);
	res.sendStatus(200);
	session.fetch(process.argv[2]).then(async res => {
		let text = await res.text();
		console.log(text);
		process.exit();
	});
});
server = app.listen(8988);

session.login({
	redirectUrl: 'http://localhost:8988/',
	oidcIssuer: 'https://solid.dschraudner.de/',
	handleRedirect: handleRedirect,
})

async function handleRedirect(url) {
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.goto(url);
	await page.type('#email', 'myemail');
	await page.type('#password', 'mypassword');
	await page.click('button[type=submit]');
	await browser.close();
}
