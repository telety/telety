# Telety.io Command Line

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
```

### Authentication

Use a telety.io authentication token. The best way to do this is to set an environment
variable with the token contents:

```sh
export TELETY_TOKEN=0000eeee-ddd4-aaa2-bbb1-cccccccfffff
```

### Host

```shell
npx @telety/telety host https://api.telety.io/channel/xxxxx/webhook
```
