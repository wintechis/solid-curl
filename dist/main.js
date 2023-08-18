"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const solid_client_authn_node_1 = require("@inrupt/solid-client-authn-node");
const process_1 = __importDefault(require("process"));
const commander_1 = require("commander");
const fs_1 = require("fs");
const loglevel_1 = __importDefault(require("loglevel"));
const keytar_1 = require("keytar");
const readline_sync_1 = require("readline-sync");
;
const n3_1 = require("n3");
const console_table_printer_1 = require("console-table-printer");
const { namedNode } = n3_1.DataFactory;
const version = '0.1.6';
// Remove draft warning from oidc-client lib
process_1.default.emitWarning = () => {
    return;
};
// Command line arguments
commander_1.program
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
    //.option('--list-users', 'List identities for which credentials are available')
    //.option('-A, --user-agent <name>', 'Send User-Agent <name> to server')
    .option('-v, --verbose', 'Make the operation more talkative')
    .option('-X, --request <method>', 'Specify custom request method', 'GET')
    .action(run);
commander_1.program
    .command('register-user')
    .argument('<uri>', 'WebID')
    .action(registerUser);
commander_1.program
    .command('delete-user')
    .argument('<identity>', 'Identity name')
    .action(deleteUser);
commander_1.program
    .command('list-users')
    .action(listUsers);
commander_1.program.parseAsync();
function run(uri, options) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        if (options.verbose) {
            loglevel_1.default.setLevel('info');
        }
        if (options.silent) {
            loglevel_1.default.setLevel('silent');
        }
        const session = new solid_client_authn_node_1.Session();
        let headers = {
            'accept': 'text/turtle, */*;q=0.8',
            'user-agent': 'solid-curl/' + version,
            'accept-encoding': 'gzip,deflate',
            'connection': 'close',
            'host': uri.split('/').slice(2, 3).join()
        };
        let fetchInit = {
            redirect: options.location ? 'follow' : 'manual'
        };
        // Loading data from file if necessary
        let data = ((_a = options.data) === null || _a === void 0 ? void 0 : _a.startsWith('@')) ? (0, fs_1.createReadStream)(options.data.substring(1)) : options.data;
        if (data) {
            fetchInit['body'] = data;
            // Default method with data is POST
            fetchInit['method'] = 'POST';
            // Default Content-Type is text/turtle but can be overriden later
            headers['content-type'] = 'text/turtle';
        }
        // Setting method
        if (options.request) {
            fetchInit['method'] = options.request;
        }
        // Transforming headers into format needed by fetch
        for (let h of (options === null || options === void 0 ? void 0 : options.header) || []) {
            let split = h.split(':');
            headers[split[0].toLowerCase()] = split.slice(1).join().trim();
        }
        fetchInit['headers'] = headers;
        const user = options.user;
        // Do unauthenticated request when no user is provided
        if (!user) {
            loglevel_1.default.info('* No user identity given, doing unauthenticated request');
            yield doFetch(uri, fetchInit, headers, session, process_1.default.stdout, options === null || options === void 0 ? void 0 : options.include);
            process_1.default.exit();
        }
        // Get credentials from storage
        let credentials = yield (0, keytar_1.findCredentials)('solid-curl');
        if (!credentials.some(c => c.account === user)) {
            loglevel_1.default.error('No credentials with name \'' + user + '\' found!');
            process_1.default.exit(1);
        }
        let creds = JSON.parse(credentials.find(c => c.account === user).password);
        // Log in
        let oidcIssuer = creds['oidcIssuer'];
        loglevel_1.default.info(`* Initiating OIDC login at ${oidcIssuer}`);
        yield session.login({
            oidcIssuer: oidcIssuer,
            clientId: creds['id'],
            clientSecret: creds['secret']
        });
        yield doFetch(uri, fetchInit, headers, session, process_1.default.stdout, options === null || options === void 0 ? void 0 : options.include);
        process_1.default.exit();
    });
}
function listUsers() {
    return __awaiter(this, void 0, void 0, function* () {
        let credentials = yield (0, keytar_1.findCredentials)('solid-curl');
        let prettyCredentials = credentials.map(c => {
            let creds = JSON.parse(c.password);
            return {
                Identity: c.account,
                WebID: creds['webId'],
                'OIDC Issuer': creds['oidcIssuer'],
                ClientID: creds['id']
            };
        });
        (0, console_table_printer_1.printTable)(prettyCredentials);
    });
}
function registerUser(webId) {
    return __awaiter(this, void 0, void 0, function* () {
        let oidcIssuer = yield getOIDCIssuer(webId);
        let credentials = yield registerApp(oidcIssuer);
        console.log('Successfully created credentials!');
        let identity = (0, readline_sync_1.question)('Identity name: ');
        (0, keytar_1.setPassword)('solid-curl', identity, JSON.stringify({
            webId: webId,
            oidcIssuer: oidcIssuer,
            id: credentials.id,
            secret: credentials.secret
        }));
    });
}
function deleteUser(identity) {
    return __awaiter(this, void 0, void 0, function* () {
        let creds = yield (0, keytar_1.getPassword)('solid-curl', identity);
        if (creds == null) {
            throw Error('Identity "' + identity + '" not found!');
        }
        let credsParsed = JSON.parse(creds);
        let oidcIssuer = credsParsed['oidcIssuer'];
        let clientId = credsParsed['id'];
        yield deregisterApp(oidcIssuer, clientId);
        (0, keytar_1.deletePassword)('solid-curl', identity);
    });
}
function registerApp(oidcIssuer) {
    return __awaiter(this, void 0, void 0, function* () {
        // Try Community Solid Server
        let response = yield fetch(oidcIssuer + 'idp/credentials/');
        if (response.status == 405) {
            console.log('Authenticating with ' + oidcIssuer + ' (Community Solid Server):');
            let email = (0, readline_sync_1.question)('E-Mail: ');
            let password = (0, readline_sync_1.question)('Password: ', {
                hideEchoBack: true
            });
            response = yield fetch(oidcIssuer + 'idp/credentials/', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    password: password,
                    name: 'solid-curl'
                })
            });
            if (response.status == 200) {
                return yield response.json();
            }
            else {
                throw Error(yield response.text());
            }
        }
        throw Error('No client registration could be found for the OIDC issuer!');
    });
}
function deregisterApp(oidcIssuer, clientId) {
    return __awaiter(this, void 0, void 0, function* () {
        // Try Community Solid Server
        let response = yield fetch(oidcIssuer + 'idp/credentials/');
        if (response.status == 405) {
            console.log('Authenticating with ' + oidcIssuer + ' (Community Solid Server):');
            let email = (0, readline_sync_1.question)('E-Mail: ');
            let password = (0, readline_sync_1.question)('Password: ', {
                hideEchoBack: true
            });
            response = yield fetch(oidcIssuer + 'idp/credentials/', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    password: password,
                    delete: clientId
                })
            });
            if (response.status == 200) {
                return yield response.json();
            }
            else {
                throw Error(yield response.text());
            }
        }
        throw Error('No client registration could be found for the OIDC issuer!');
    });
}
function getOIDCIssuer(webId) {
    return __awaiter(this, void 0, void 0, function* () {
        let response = yield fetch(webId);
        let quads = yield parseQuads(yield response.text());
        let store = new n3_1.Store();
        store.addQuads(quads);
        let issuers = store.getObjects(namedNode(webId), namedNode('http://www.w3.org/ns/solid/terms#oidcIssuer'), null);
        if (issuers.length > 0) {
            return issuers[0].value;
        }
        else {
            throw Error('No OIDC issuer in Profile Document found!');
        }
    });
}
function parseQuads(text) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            let quads = [];
            let parser = new n3_1.Parser();
            parser.parse(text, (error, quad) => {
                if (error) {
                    reject(error);
                }
                if (quad) {
                    quads.push(quad);
                }
                else {
                    resolve(quads);
                }
            });
        });
    });
}
function doFetch(uri, fetchInit, headers, session, outStream, include) {
    return __awaiter(this, void 0, void 0, function* () {
        // Do actual request
        loglevel_1.default.info(`> ${fetchInit.method} /${uri.split('/').slice(3).join('/')} HTTP/1.1`);
        for (let h in headers) {
            // Make header names upercase for logging
            loglevel_1.default.info(`> ${h.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('-')}: ${headers[h]}`);
        }
        // If request was authenticated, add placeholder for DPoP
        if (session.info.isLoggedIn) {
            loglevel_1.default.info(`> Authorization: DPoP [omitted]`);
        }
        loglevel_1.default.info('>');
        try {
            let res = yield session.fetch(uri, fetchInit);
            loglevel_1.default.info(`< HTTP/1.1 ${res.status} ${res.statusText}`);
            if (include) {
                outStream.write(`HTTP/1.1 ${res.status} ${res.statusText}\n`);
            }
            for (let h of res.headers) {
                loglevel_1.default.info(`< ${h[0].split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('-')}: ${h[1]}`);
                if (include) {
                    outStream.write(`${'\x1b[1m'}${h[0].split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('-')}${'\x1b[0m'}: ${h[1]}\n`);
                }
            }
            if (include) {
                outStream.write(`\n`);
            }
            loglevel_1.default.info('<');
            let buffer = Buffer.from(yield res.arrayBuffer());
            outStream.write(buffer);
        }
        catch (error) {
            if (error['errno'] === 'ENOTFOUND') {
                loglevel_1.default.error(`Could not resolve host: ${uri.split('/').slice(2, 3).join()}`);
            }
            else if (error['errno'] === 'ECONNREFUSED') {
                loglevel_1.default.error(`Connection refused: ${uri.split('/').slice(2, 3).join()}`);
            }
        }
    });
}
