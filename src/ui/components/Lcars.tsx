import type { ButtonHTMLAttributes, ReactNode } from 'react';
export function LcarsButton({
  tone = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'secondary' | 'danger' }) {
  return <button className={'lcars-button ' + tone + ' ' + className} {...props} />;
}
export function LcarsDialog({
  title,
  children,
  label,
}: {
  title: string;
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="composer-backdrop">
      <section className="lcars-dialog" role="dialog" aria-modal="true" aria-label={label}>
        <div className="section-title">{title}</div>
        {children}
      </section>
    </div>
  );
}
