import { useMemo, type ReactNode } from 'react';
import { marked, type Token, type Tokens } from 'marked';
import s from './portfolio-memo-document.module.css';

function render(tokens: Token[]): ReactNode {
    return tokens.map((token, index) => {
        const children =
            'tokens' in token && token.tokens
                ? render(token.tokens)
                : 'text' in token
                  ? token.text
                  : '';
        switch (token.type) {
            case 'heading':
                return token.depth < 3 ? (
                    <h3 key={index}>{children}</h3>
                ) : (
                    <h4 key={index}>{children}</h4>
                );
            case 'paragraph':
                return <p key={index}>{children}</p>;
            case 'strong':
                return <strong key={index}>{children}</strong>;
            case 'em':
                return <em key={index}>{children}</em>;
            case 'del':
                return <del key={index}>{children}</del>;
            case 'link':
                return /^https?:\/\//i.test(token.href) ? (
                    <a
                        key={index}
                        href={token.href}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {children}
                    </a>
                ) : (
                    <span key={index}>{children}</span>
                );
            case 'list': {
                const items = (token as Tokens.List).items.map(
                    (item, itemIndex) => (
                        <li key={itemIndex}>{render(item.tokens)}</li>
                    ),
                );
                return token.ordered ? (
                    <ol
                        key={index}
                        start={
                            typeof token.start === 'number' ? token.start : 1
                        }
                    >
                        {items}
                    </ol>
                ) : (
                    <ul key={index}>{items}</ul>
                );
            }
            case 'table': {
                const table = token as Tokens.Table;
                return (
                    <div className={s.table} key={index}>
                        <table>
                            <thead>
                                <tr>
                                    {table.header.map((cell, i) => (
                                        <th key={i}>{render(cell.tokens)}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {table.rows.map((row, i) => (
                                    <tr key={i}>
                                        {row.map((cell, j) => (
                                            <td key={j}>
                                                {render(cell.tokens)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            }
            case 'blockquote':
                return <blockquote key={index}>{children}</blockquote>;
            case 'code':
                return (
                    <pre key={index}>
                        <code>{token.text}</code>
                    </pre>
                );
            case 'codespan':
                return <code key={index}>{token.text}</code>;
            case 'hr':
                return <hr key={index} />;
            case 'br':
                return <br key={index} />;
            case 'space':
            case 'image':
                return null;
            // Raw HTML stays escaped. Memo artifacts are data, never executable markup.
            default:
                return <span key={index}>{children}</span>;
        }
    });
}

export function PortfolioMemoDocument({ text }: { text: string }) {
    const tokens = useMemo(() => marked.lexer(text), [text]);
    return <div className={s.document}>{render(tokens)}</div>;
}
