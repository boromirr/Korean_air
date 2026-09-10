/** Classify public UI text only; do not inspect security internals or cookies. */
export function sasRestriction(text: string): 'restricted' | 'action_required' | null {
  if (/access restricted|access denied|not allowed to board|denied boarding|request has been blocked/i.test(text)) return 'restricted';
  if (/verify you are human|unusual traffic|captcha/i.test(text)) return 'action_required';
  return null;
}
