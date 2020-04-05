import { Command, BaseCommand } from '@jib/cli';

export interface ITeletyOptions {
  // define invocation option types here
}

@Command({
  description: 'telety command',
  options: [ /** Configure command options */ ],
  args: [ /** Configure any arguments */ ],
})
export class TeletyCommand extends BaseCommand {
  public help(): void {
    // print additional help here
    // this.ui.output(...)
  }
  public async run(options: ITeletyOptions, ...args: string[]) {
    this.ui.output(`Hello from telety`);
    // Do telety things...
  }
}
