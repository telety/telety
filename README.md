# Telety.io Command Line

[![wercker status](https://app.wercker.com/status/bd2efdcdeabbace2f652b2ffc7798b04/s/master "wercker status")](https://app.wercker.com/project/byKey/bd2efdcdeabbace2f652b2ffc7798b04)

## About

Refer to [`telety.io docs`](../../docs)

## Usage

```shell
npx @telety/telety
```

```text
telety --help

Usage: <command> [options]

Options:

  -h, --help       output command usage information
  -v, --version    display command version number

Commands:

  host    Create TTY session piping stdin to a channel webhook
  join    Join a telety channel with a TTY interface
```

### Authentication

Use a telety.io authentication token. The best way to do this is to set an environment
variable with the token contents:

```sh
export TELETY_TOKEN=0000eeee-ddd4-aaa2-bbb1-cccccccfffff
```

### Host

Hosting from the terminal provides a means of securely
piping shell commands to `telety.io`, and simultaneously
executing the commands on your machine. Sensitive inputs
are redacted automatically

```shell
npx @telety/telety host https://api.telety.io/channel/xxxxx/webhook
```

```text
Usage: host [options] <webhookURL>

Create TTY session piping stdin to a channel webhook

Arguments:

  <webhookURL>    telety.io webhook URL

Options:

  -h, --help                  output command usage information
  -t, --auth-token <token>    telety.io authentication token
  -p, --prompt-text <text>    customize host prompt text          (default telety)
```

### Join

Users may also join a `telety.io` session from the terminal,
allowing a complete history of inputs to be retrieved as
history from the prompt. Any new commands will also be received
in **real time**.

> **NOTE:** Only registered users may join from the CLI

```shell
npx @telety/telety join https://api.telety.io/channel/xxxxx/webhook
```

```text
Usage: join [options] <webhookURL>

Join a telety channel with a TTY interface

Arguments:

  <webhookURL>    telety.io webhook URL

Options:

  -h, --help                  output command usage information
  -t, --auth-token <token>    telety.io authentication token
  -p, --prompt-text <text>    customize host prompt text          (default telety)
  -P, --print-history         output all channel history
```
