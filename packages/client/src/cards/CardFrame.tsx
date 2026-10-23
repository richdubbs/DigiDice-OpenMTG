/**
 * Our own text frame (ARCHITECTURE.md "Card images" A): name, mana cost as our lettered circles, type line, rules text, P/T, loyalty or defense, styled by
 * the card's colors. No Wizards frames, mana or set symbols (docs/design/m8-client.md "Visual design").
 *
 * Layouts: one face (normal, saga, class, leveler, case, mutate, prototype, ...); split (CR 709: both halves on one card); adventure (CR 715: the
 * adventure inset beside the card's own text, on the left); prepare (CR 722.1: the prepare spell in an inset frame on the right, CR 722.2); flip (CR 710: the flipped half upside down at the bottom); double-faced (CR 712: the shown side, with a
 * note naming the other side); tokens and emblems (CR 111, 114) are marked as such.
 */
import type { ReactNode } from 'react';
import type { CardDef } from '@openmtg/engine';
import { emblemTypeOf, textLenOf } from './artSeed';
import { CardArt } from './CardArt';
import { FrameText } from './FrameText';
import { ManaCost } from './ManaGlyph';
import { frameColors, frameTone, isTwoSided, shownFace, type CardFaceModel, type CardModel } from './model';
import { TypeEmblem } from './TypeEmblem';

function Stats({ face }: { face: CardFaceModel }) {
  if (face.loyalty !== undefined)
    return (
      <span className="frame-stat frame-loyalty" aria-label={`Loyalty ${face.loyalty}`}>
        {face.loyalty}
      </span>
    );
  if (face.defense !== undefined)
    return (
      <span className="frame-stat frame-defense" aria-label={`Defense ${face.defense}`}>
        {face.defense}
      </span>
    );
  if (face.power !== undefined || face.toughness !== undefined) {
    const pt = `${face.power ?? '?'}/${face.toughness ?? '?'}`;
    return (
      <span className="frame-stat frame-pt" aria-label={`Power and toughness ${pt}`}>
        {pt}
      </span>
    );
  }
  return null;
}

/** The art box of a card (or of the band shared by the halves of a split or flip card). */
function Art({ card, face, seed, typeLine, oracleText }: { card: CardModel; face: number; seed: string; typeLine: string; oracleText: string }) {
  return <CardArt seedName={seed} colors={frameColors(card, face)} typeLine={typeLine} oracleText={oracleText} />;
}

/** The type line bar: the type, the Token / Emblem tag, and the type emblem where a printed card has its set symbol. */
function TypeBar({ typeLine, tag }: { typeLine: string; tag?: string | undefined }) {
  return (
    <div className="frame-type">
      <span className="frame-type-text">{typeLine}</span>
      {tag && <span className="frame-tag">{tag}</span>}
      <TypeEmblem type={emblemTypeOf(typeLine)} className="type-medal" />
    </div>
  );
}

interface FaceProps {
  face: CardFaceModel;
  index: number;
  def?: CardDef | undefined;
  layout: string;
  tag?: string | undefined;
  className?: string;
  /** The art box of this face (omitted for the halves of split and flip cards, which share a band). */
  art?: ReactNode;
}

function FaceBlock({ face, index, def, layout, tag, className = '', art }: FaceProps) {
  return (
    <div className={`frame-face ${className}`} data-face={index} data-len={textLenOf(face.oracleText)}>
      <div className="frame-title">
        <span className="frame-name">{face.name}</span>
        <ManaCost cost={face.manaCost} />
      </div>
      {art}
      <TypeBar typeLine={face.typeLine} tag={tag} />
      <FrameText face={face} faceIndex={index} def={def} layout={layout} />
      <div className="frame-bottom">
        <Stats face={face} />
      </div>
    </div>
  );
}

/** A small frame inside the card's text box: the adventure (CR 715.2) or the prepare spell (CR 722.1). */
function Inset({ face, index, def, layout }: { face: CardFaceModel; index: number; def?: CardDef | undefined; layout: 'adventure' | 'prepare' }) {
  return (
    <div className={`frame-inset frame-${layout}`} data-face={index}>
      <div className="frame-title">
        <span className="frame-name">{face.name}</span>
        <ManaCost cost={face.manaCost} />
      </div>
      <div className="frame-type">{face.typeLine}</div>
      <FrameText face={face} faceIndex={index} def={def} layout={layout} />
    </div>
  );
}

export interface CardFrameProps {
  card: CardModel;
  /** For a double-faced card: which side to show. */
  face?: number;
  /** The card's picture is still on its way: this frame stands in for it meanwhile (the fx layer waits for it before flying the card, board/fx/Animator.ts). */
  pending?: boolean;
}

export function CardFrame({ card, face = 0, pending = false }: CardFrameProps) {
  const shown = shownFace(card, face);
  const tone = frameTone(card, face);
  const tag = card.layout === 'emblem' ? 'Emblem' : card.isToken ? 'Token' : undefined;
  const [f0, f1] = card.faces as [CardFaceModel, CardFaceModel | undefined];
  let content;
  if (card.layout === 'split' && f1) {
    content = (
      <div className="frame-split">
        <Art card={card} face={shown} seed={card.name} typeLine={card.faces.map((x) => x.typeLine).join(' // ')} oracleText={card.faces.map((x) => x.oracleText).join(' ')} />
        {card.faces.map((f, i) => (
          <FaceBlock key={i} face={f} index={i} def={card.def} layout="split" className="frame-half" />
        ))}
      </div>
    );
  } else if ((card.layout === 'adventure' || card.layout === 'prepare') && f1) {
    // CR 715.2: the adventure inset is on the left of the text box; CR 722.2: the prepare spell's inset is on the right.
    const layout = card.layout;
    const inset = <Inset face={f1} index={1} def={card.def} layout={layout} />;
    content = (
      <div className="frame-face" data-face={0} data-len={textLenOf(f0.oracleText + f1.oracleText)}>
        <div className="frame-title">
          <span className="frame-name">{f0.name}</span>
          <ManaCost cost={f0.manaCost} />
        </div>
        <Art card={card} face={0} seed={f0.name} typeLine={f0.typeLine} oracleText={f0.oracleText} />
        <TypeBar typeLine={f0.typeLine} />
        <div className="frame-inset-row">
          {layout === 'adventure' && inset}
          <FrameText face={f0} faceIndex={0} def={card.def} layout={layout} />
          {layout === 'prepare' && inset}
        </div>
        <div className="frame-bottom">
          <Stats face={f0} />
        </div>
      </div>
    );
  } else if (card.layout === 'flip' && f1) {
    content = (
      <div className="frame-flip">
        <FaceBlock face={f0} index={0} def={card.def} layout="flip" className="frame-half" />
        <Art card={card} face={0} seed={card.name} typeLine={f0.typeLine} oracleText={f0.oracleText} />
        <FaceBlock face={f1} index={1} def={card.def} layout="flip" className="frame-half frame-upside-down" />
      </div>
    );
  } else {
    const f = card.faces[shown] ?? f0;
    const other = isTwoSided(card) ? card.faces[1 - shown] : undefined;
    content = (
      <>
        <FaceBlock
          face={f}
          index={shown}
          def={card.def}
          layout={card.layout}
          tag={tag}
          art={<Art card={card} face={shown} seed={f.name} typeLine={f.typeLine} oracleText={f.oracleText} />}
        />
        {other && (
          <p className="frame-other-side">
            {shown === 0 ? 'Back' : 'Front'}: {other.name}
            {other.typeLine ? ` — ${other.typeLine}` : ''}
          </p>
        )}
      </>
    );
  }
  return (
    <div className={`card-frame tone-${tone}`} data-layout={card.layout} data-tone={tone} {...(pending ? { 'data-picture-pending': '' } : {})}>
      {content}
    </div>
  );
}
