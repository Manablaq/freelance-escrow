import type { WriteLifecycleCallbacks } from "./genlayer";

export function submitUntilHash(
  submit: (lifecycle: WriteLifecycleCallbacks) => Promise<string>,
  lifecycle: WriteLifecycleCallbacks,
) {
  return new Promise<string>((resolve, reject) => {
    let handedOff = false;
    const handOff = (hash: string) => {
      if (handedOff) return;
      handedOff = true;
      lifecycle.onSubmitted?.(hash);
      resolve(hash);
    };
    void submit({
      ...lifecycle,
      onSubmitted: handOff,
    }).then(handOff, (error) => {
      if (!handedOff) reject(error);
    });
  });
}
