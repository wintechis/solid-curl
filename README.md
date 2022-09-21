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
Usage: solid-curl [options] [command] <uri>

Arguments:
  uri                       Target URI

Options:
  -V, --version             Show version number and quit
  -d, --data <data>         HTTP POST data
  -H, --header <header...>  Add header to request
  -i, --include             Include HTTP response headers in output
  -L, --location            Follow redirects
  -s, --silent              Silent mode
  -u, --user <identity>     Use stored identity
  -u, -- <identity>         Use stored identity
  -v, --verbose             Make the operation more talkative
  -X, --request <method>    Specify custom request method
  -h, --help                display help for command

Commands:
  register-user <uri>
  delete-user <identity>
  list-users
```
```
Usage: solid-curl register-user [options] <uri>

Arguments:
  uri         WebID

Options:
  -h, --help  display help for command
```
Usage: solid-curl delete-user [options] <identity>

Arguments:
  identity    Identity name

Options:
  -h, --help  display help for command
```
```
Usage: solid-curl list-users [options]

Options:
  -h, --help  display help for command
```

## User Identities
solid-curl saves user identities to the keyring. New users can be registered using
```
solid-curl register-user <webId>
```
The name that is given to the user in the following dialog can be used with the `-u` parameter to automatically authenticate the request.
