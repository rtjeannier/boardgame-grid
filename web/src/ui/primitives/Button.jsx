import css from './Button.module.css';

/** The tones there are. Named, so a typo is a missing class at the call site. */
const TONE = {
  default: '', primary: css.primary, quiet: css.quiet, stop: css.stop, later: css.later,
};

/** One button. `tone` picks which of the five it is; there are no others. */
export default function Button({ tone = 'default', children, ...rest }) {
  const extra = TONE[tone] ?? '';
  return <button type="button" className={`${css.btn} ${extra}`.trim()} {...rest}>{children}</button>;
}
