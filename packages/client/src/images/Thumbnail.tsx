/**
 * A small preview of an image Blob (an uploaded file or a stored image), shown whole (aspect ratio kept). Its object URL is keyed on `version` (a
 * stable identity such as the slot key and when it was stored), not on the Blob object: reloading the stored list gives new Blob objects for the same
 * images, and those must not re-create (and re-decode) every thumbnail.
 */
import { useEffect, useRef, useState } from 'react';
import { useCardImages } from './context';

export function Thumbnail({ blob, version, alt }: { blob: Blob; version: string; alt: string }) {
  const { urls } = useCardImages();
  const [url, setUrl] = useState<string | null>(null);
  const latest = useRef(blob);
  latest.current = blob;
  useEffect(() => {
    const u = urls.create(latest.current);
    setUrl(u);
    return () => urls.revoke(u);
  }, [version, urls]);
  return <span className="image-thumb">{url ? <img src={url} alt={alt} draggable={false} /> : null}</span>;
}
