import Image from "next/image";
import Link from "next/link";

function InlineContent({ segments, text }) {
  if (!Array.isArray(segments)) return text;
  return segments.map((segment, index) => {
    const value = typeof segment === "string" ? segment : segment?.text;
    let content = segment?.strong ? <strong>{value}</strong> : value;
    if (segment?.href?.startsWith("http")) {
      content = <a href={segment.href} rel="noopener noreferrer">{content}</a>;
    } else if (segment?.href) {
      content = <Link href={segment.href}>{content}</Link>;
    }
    return <span key={`${value}-${index}`}>{content}</span>;
  });
}

export function JournalArticleBlock({ block, faqs = [] }) {
  if (block.type === "heading") return <h2 id={block.id}>{block.text}</h2>;
  if (block.type === "subheading") {
    return <h3 className="article-subheading" id={block.id}>{block.text}</h3>;
  }
  if (block.type === "quote") return <blockquote>{block.text}</blockquote>;
  if (block.type === "list") {
    return <ul>{(block.items || []).map((item, index) => (
      <li key={typeof item === "string" ? item : index}>
        {typeof item === "string" ? item : <InlineContent segments={item} />}
      </li>
    ))}</ul>;
  }
  if (block.type === "ordered-list") {
    return <ol>{(block.items || []).map((item, index) => (
      <li key={index}>
        {typeof item === "string" ? item : <InlineContent segments={item} />}
      </li>
    ))}</ol>;
  }
  if (block.type === "formula") {
    return (
      <aside className="article-formula">
        <span>{block.label}</span><strong>=</strong><b>{block.formula}</b>
      </aside>
    );
  }
  if (block.type === "result") {
    return <p className="article-result"><InlineContent segments={block.segments} text={block.text} /></p>;
  }
  if (block.type === "table") {
    return (
      <div className="article-table-wrap">
        <table>
          <caption className="sr-only">{block.caption}</caption>
          <thead><tr>{(block.headers || []).map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
          <tbody>{(block.rows || []).map((row, rowIndex) => (
            <tr className={rowIndex === block.totalRow ? "is-total" : ""} key={`${rowIndex}-${row.join("-")}`}>
              {row.map((cell, cellIndex) => cellIndex === 0
                ? <th scope="row" key={`${cell}-${cellIndex}`}>{cell}</th>
                : <td key={`${cell}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
  }
  if (block.type === "faqs") {
    return (
      <div className="article-faqs">
        {faqs.map((faq) => (
          <section key={faq.question}><h3>{faq.question}</h3><p>{faq.answer}</p></section>
        ))}
      </div>
    );
  }
  if (block.type === "callout") {
    return <aside className="article-callout"><strong>{block.title}</strong><p>{block.text}</p></aside>;
  }
  if (block.type === "image") {
    return (
      <figure className="article-inline-image">
        <Image
          src={block.src}
          alt={block.alt}
          width={block.width}
          height={block.height}
          loading="lazy"
        />
        <figcaption>
          {block.caption}{" "}
          {block.creditUrl ? <a href={block.creditUrl} rel="noopener noreferrer">{block.credit}</a> : block.credit}.
        </figcaption>
      </figure>
    );
  }
  return <p><InlineContent segments={block.segments} text={block.text} /></p>;
}

export default function JournalArticleContent({ article }) {
  return (article?.content || []).map((block, index) => (
    <JournalArticleBlock
      block={block}
      faqs={article?.faqs || []}
      key={`${block.type}-${block.id || index}-${index}`}
    />
  ));
}
