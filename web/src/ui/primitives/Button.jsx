import css from './Button.module.css';

/** One button. `tone` picks which of the four it is; there are no others. */
export default function Button({ tone = 'default', children, ...rest }) {
  const extra = tone === 'default' ? '' : css[tone];
  return <button type="button" className={`${css.btn} ${extra}`.trim()} {...rest}>{children}</button>;
}
