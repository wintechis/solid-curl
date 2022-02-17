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
const express_1 = __importDefault(require("express"));
const solid_client_authn_node_1 = require("@inrupt/solid-client-authn-node");
const puppeteer_1 = __importDefault(require("puppeteer"));
const process_1 = __importDefault(require("process"));
const commander_1 = require("commander");
const fs_1 = require("fs");
const loglevel_1 = __importDefault(require("loglevel"));
const os_1 = __importDefault(require("os"));
const fs_2 = __importDefault(require("fs"));
// Remove draft warning from oidc-client lib
process_1.default.emitWarning = (warning, ...args) => {
    return;
};
// Command line arguments
commander_1.program
    .version('0.1.6', '-V, --version', 'Show version number and quit')
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
            'user-agent': 'solid-curl/0.1.0',
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
        const app = (0, express_1.default)();
        let server = null;
        // Handler for the redirect from the IdP
        app.get("/", (req, expressRes) => __awaiter(this, void 0, void 0, function* () {
            loglevel_1.default.info(`* Received redirect from IdP to: ${req.url}`);
            yield session.handleIncomingRedirect(`http://localhost:29884${req.url}`);
            expressRes.sendStatus(200);
            loglevel_1.default.info(`* Doing actual request authenticated as ${session.info.webId}`);
            yield doFetch(uri, fetchInit, headers, session, process_1.default.stdout, options === null || options === void 0 ? void 0 : options.include);
            process_1.default.exit();
        }));
        server = app.listen(29884);
        // Try to load credentials from config
        const config = JSON.parse(fs_2.default.readFileSync(`${os_1.default.homedir()}/.solid-curl-ids.json`).toString());
        const { oidcProvider: configOidcProvider, email: configEmail, username: configUsername, password: configPassword, } = config[options.user];
        loglevel_1.default.info(`* Loaded credentials of identity ${options.user} from config file`);
        // Log in
        let oidcIssuer = configOidcProvider; // ? configOidcProvider : readlineSync.question(`Solid OIDC Provider URI: `);
        loglevel_1.default.info(`* Initiating OIDC login at ${oidcIssuer}`);
        yield session.login({
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
        function handleRedirect(url) {
            return __awaiter(this, void 0, void 0, function* () {
                const browser = yield puppeteer_1.default.launch();
                const page = yield browser.newPage();
                loglevel_1.default.info(`* Fetching login page provided by IdP: ${url}`);
                yield page.goto(url);
                let emailField = yield page.$('#email');
                if (emailField) {
                    let email = configEmail; // ? configEmail : readlineSync.question(`${emailLabel}: `);
                    loglevel_1.default.info(`* Entering email to form: ${email}`);
                    yield emailField.type(email);
                }
                let usernameField = (yield page.$('#username')) || (yield page.$('#signInFormUsername'));
                if (usernameField) {
                    let username = configUsername; // ? configUsername : readlineSync.question(`${usernameLabel}: `);
                    loglevel_1.default.info(`* Entering username to form: ${username}`);
                    yield usernameField.type(username);
                }
                let passwordField = (yield page.$('#password')) || (yield page.$('#signInFormPassword'));
                if (passwordField) {
                    let password = configPassword; // ? configPassword : readlineSync.question(`${passwordLabel}: `, {
                    //	hideEchoBack: true,
                    //});
                    loglevel_1.default.info(`* Entering password to form: ${password.replaceAll(new RegExp('.', 'g'), '*')}`);
                    yield passwordField.type(password);
                }
                let resP = Promise.race([
                    page.waitForNavigation(),
                    new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
                ]);
                let submit = (yield page.$('button[type=submit]')) || (yield page.$('input[type=Submit]'));
                loglevel_1.default.info(`* Submitting login form`);
                yield (submit === null || submit === void 0 ? void 0 : submit.click());
                let res = yield resP;
                if (res === null) {
                    loglevel_1.default.error('Authentication did not succeed: Timed out!');
                    process_1.default.exit(1);
                }
                else {
                    // node-solid-server may redirect to another form that needs a submit
                    if (res.status() !== 200) {
                        loglevel_1.default.error(`Authentication did not succeed: ${res.status()} ${res.statusText()}`);
                        process_1.default.exit(2);
                    }
                    else {
                        let submit = (yield page.$('button[type=submit]')) || (yield page.$('button[form=approve]'));
                        if (submit) {
                            loglevel_1.default.info(`* Pressing button to allow our application`);
                            submit.click();
                            yield page.waitForNavigation();
                        }
                    }
                }
                yield browser.close();
            });
        }
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
                    outStream.write(`${'\033[1m'}${h[0].split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('-')}${'\033[0m'}: ${h[1]}\n`);
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
