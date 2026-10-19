'use client';

import React, { useState } from 'react';
import { QrCode, Share2 } from 'lucide-react';
import { CampaignQRCodeModal } from './CampaignQRCodeModal';

export interface CampaignImpactCard {
  svg: string;
  fileName: string;
}

export interface CampaignShareButtonsProps {
  campaignId: string;
  campaignName: string;
  description?: string;
  raisedAmount?: string;
  goalAmount?: string;
  shareUrl?: string;
  impactCard?: CampaignImpactCard;
}

export function buildCampaignShareMessage({
  campaignName,
  description,
  raisedAmount,
  goalAmount,
}: Pick<CampaignShareButtonsProps, 'campaignName' | 'description' | 'raisedAmount' | 'goalAmount'>): string {
  const progress = raisedAmount && goalAmount ? ` ${raisedAmount}/${goalAmount} raised.` : '';
  const impact = description ? ` ${description}` : '';
  return `Support ${campaignName}!${impact}${progress}`;
}

export function buildCampaignShareLinks(props: CampaignShareButtonsProps) {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://fundable.example';
  const url = props.shareUrl ?? `${origin}/campaigns/${encodeURIComponent(props.campaignId)}`;
  const message = buildCampaignShareMessage(props);
  return {
    canonicalUrl: url,
    twitter: `https://twitter.com/intent/tweet?${new URLSearchParams({ text: message, url }).toString()}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url, quote: message }).toString()}`,
    whatsapp: `https://wa.me/?${new URLSearchParams({ text: `${message} ${url}` }).toString()}`,
  };
}

async function svgToPngBlob(svg: string): Promise<Blob> {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load impact card SVG'));
      img.src = objectUrl;
    });
    const width = image.naturalWidth || 1200;
    const height = image.naturalHeight || 630;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to render impact card PNG'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function CampaignShareButtons(props: CampaignShareButtonsProps) {
  const [showQRModal, setShowQRModal] = useState(false);
  const [impactCardBusy, setImpactCardBusy] = useState(false);
  const links = buildCampaignShareLinks(props);

  const handleShareImpactCard = async () => {
    if (!props.impactCard || impactCardBusy) return;
    setImpactCardBusy(true);
    try {
      const pngBlob = await svgToPngBlob(props.impactCard.svg);
      const fileName = props.impactCard.fileName.endsWith('.png')
        ? props.impactCard.fileName
        : `${props.impactCard.fileName}.png`;
      const file = new File([pngBlob], fileName, { type: 'image/png' });
      const nav = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: props.campaignName, url: links.canonicalUrl });
      } else {
        const downloadUrl = URL.createObjectURL(pngBlob);
        const anchor = document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(downloadUrl);
      }
    } catch (error) {
      console.error('Failed to share impact card', error);
    } finally {
      setImpactCardBusy(false);
    }
  };
  const items = [
    { name: 'Twitter', href: links.twitter, className: 'bg-sky-500 hover:bg-sky-600' },
    { name: 'Facebook', href: links.facebook, className: 'bg-blue-600 hover:bg-blue-700' },
    { name: 'WhatsApp', href: links.whatsapp, className: 'bg-green-600 hover:bg-green-700' },
  ];

  return (
    <div aria-label="Share campaign" className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <a
          key={item.name}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`rounded-md px-3 py-2 text-sm font-medium text-white transition-colors ${item.className}`}
        >
          Share on {item.name}
        </a>
      ))}
      {props.impactCard && (
        <button
          type="button"
          aria-label="Share impact card"
          onClick={handleShareImpactCard}
          disabled={impactCardBusy}
          className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Share2 className="h-4 w-4" />
          {impactCardBusy ? 'Preparing…' : 'Share impact card'}
        </button>
      )}
      <button
        type="button"
        aria-label="Download Campaign QR Code"
        onClick={() => setShowQRModal(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700 transition-colors"
      >
        <QrCode className="h-4 w-4 text-purple-400" />
        QR Code
      </button>

      <CampaignQRCodeModal
        open={showQRModal}
        onOpenChange={setShowQRModal}
        campaignId={props.campaignId}
        campaignName={props.campaignName}
        canonicalUrl={links.canonicalUrl}
      />
    </div>
  );
}
