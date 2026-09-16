import Image from 'next/image';
import Link from 'next/link';
import { localePath } from '@/lib/locale-path';
import { lensAssets } from './assets';

export type GalleryCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  items: {
    eyebrow: string;
    title: string;
    text: string;
    tags: string[];
    link: string;
    alt: string;
  }[];
};

export function LensGallery({ copy, locale }: { copy: GalleryCopy; locale: string }) {
  const images = [lensAssets.verification, lensAssets.fichiers, lensAssets.integrations];
  const links = ['#lens-iban', localePath(locale, '/audit'), localePath(locale, '/docs')];
  return (
    <section className="lens-gallery" id="lens-usages" aria-labelledby="lens-usages-title">
      <header>
        <p className="lens-eyebrow">{copy.eyebrow}</p>
        <h2 id="lens-usages-title">{copy.title}</h2>
        <p>{copy.intro}</p>
      </header>
      {copy.items.map((item, i) => (
        <article className="lens-usage" key={item.eyebrow}>
          <figure>
            <Image
              src={images[i]}
              alt={item.alt}
              width={1536}
              height={1024}
              sizes="(max-width: 820px) 94vw, 52vw"
            />
          </figure>
          <div>
            <p className="lens-eyebrow">{item.eyebrow}</p>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <div className="lens-tags">
              {item.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <Link href={links[i]}>
              {item.link} <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
