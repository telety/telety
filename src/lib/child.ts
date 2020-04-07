import * as child_process from 'child_process';

export { child_process as child };

export class ChildPromise {

  public static resolve(child: child_process.ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => code ? reject() : resolve());
      child.on('exit', code => code ? reject() : resolve());
    });
  }
}
