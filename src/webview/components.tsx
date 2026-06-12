import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function Codicon({ name, className = '', title }: { name: string; className?: string; title?: string }) {
  return <span className={`codicon codicon-${name}${className ? ` ${className}` : ''}`} aria-hidden={title ? undefined : true} title={title} />;
}

export function VSCodeButton({ children, className = '', icon, variant = 'secondary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string; variant?: ButtonVariant }) {
  return <button {...props} className={`vscode-button vscode-button-${variant}${icon ? ' has-icon' : ''}${className ? ` ${className}` : ''}`}>
    {icon && <Codicon name={icon} />}
    {children}
  </button>;
}

export function VSCodeIconButton({ className = '', icon, title, variant = 'ghost', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; title: string; variant?: ButtonVariant }) {
  return <VSCodeButton {...props} className={`vscode-icon-button${className ? ` ${className}` : ''}`} icon={icon} title={title} aria-label={props['aria-label'] ?? title} variant={variant} />;
}

export function VSCodeInput({ label, className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className={`vscode-field${className ? ` ${className}` : ''}`}>
    <span>{label}</span>
    <input className="vscode-control" {...props} />
  </label>;
}

export function VSCodeTextarea({ label, className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return <label className={`vscode-field${className ? ` ${className}` : ''}`}>
    <span>{label}</span>
    <textarea className="vscode-control" {...props} />
  </label>;
}

export function VSCodeSelect({ children, label, className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <label className={`vscode-field${className ? ` ${className}` : ''}`}>
    <span>{label}</span>
    <select className="vscode-control" {...props}>{children}</select>
  </label>;
}

export function VSCodeCheckbox({ children, className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement> & { children: React.ReactNode }) {
  return <label className={`vscode-checkbox${className ? ` ${className}` : ''}`}>
    <input type="checkbox" {...props} />
    <span>{children}</span>
  </label>;
}

export function VSCodeSection({ children, defaultOpen, title }: { children: React.ReactNode; defaultOpen?: boolean; title: string }) {
  return <details className="vscode-section" open={defaultOpen}>
    <summary><Codicon name="chevron-right" /><span>{title}</span></summary>
    <div className="vscode-section-body">{children}</div>
  </details>;
}
