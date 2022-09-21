[![npm-version](https://img.shields.io/npm/v/solid-curl)](https://img.shields.io/npm/v/solid-curl)
[![node-version](https://img.shields.io/node/v/solid-curl)](https://img.shields.io/node/v/solid-curl)
[![license](https://img.shields.io/github/license/wintechis/solid-curl)](https://github.com/wintechis/solid-curl/blob/main/LICENSE)
[![publish-npm](https://github.com/wintechis/solid-curl/actions/workflows/npm-publish.yml/badge.svg?branch=main)](https://github.com/wintechis/solid-curl/actions/workflows/npm-publish.yml)

# solid-curl
Command line application mimicking the behaviour of cURL but authenticating using Solid-OIDC

## Installation
```
npm install -g solid-curl
```

## Usage
```
Usage: solid-curl [options] <uri>

Arguments:
  uri                       Target URI

Options:
  -V, --version             Show version number and quit
  -d, --data <data>         HTTP POST data
  -H, --header <header...>  Add header to request
  -i, --include             Include HTTP response headers in output
  -L, --location            Follow redirects
  -s, --silent              Silent mode
  -u, --user <identity>     Use identity from config file
  -v, --verbose             Make the operation more talkative
  -X, --request <method>    Specify custom request method (default: "GET")
  -h, --help                display help for command
```

## User Identities
To use Solid-OIDC you have to specify an identity using the `-u` option. For every identity you first have to create it in a file named `.solid-curl-ids.json` in your home directory. An example file for the identities `dschraudner` and `community` could look like this:

```
{
        "dschraudner": {
                "oidcProvider": "https://solid.dschraudner.de/",
                "email": "daniel@example.de",
                "password": "myverysecretpassword"
        },
        "community": {
                "oidcProvider": "https://solidcommunity.net/",
                "username": "dschraudner",
                "password": "anothersecretpassword"
        }
}
```

**Note:** Make sure that your identity file is not readable for others e. g. by using `chmod 600 .solid-curl-ids.json`!
