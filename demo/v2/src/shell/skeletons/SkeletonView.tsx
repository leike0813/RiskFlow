// 骨架屏：loading 态按页面骨架种类渲染对应的结构块，纯 CSS 微光动画。
// 复合骨架（A+C / A+B）按主从布局同时渲染两半。

import type { SkeletonKind } from './skeletons';
import './skeletons.css';

function Block({ className }: { className: string }) {
  return <div className={`sk-block ${className}`} aria-hidden="true" />;
}

function SkeletonA() {
  return (
    <div className="sk sk-a" aria-hidden="true">
      <Block className="sk-toolbar" />
      <Block className="sk-row" />
      <Block className="sk-row" />
      <Block className="sk-row" />
      <Block className="sk-row" />
      <Block className="sk-row" />
    </div>
  );
}

function SkeletonB() {
  return (
    <div className="sk sk-b" aria-hidden="true">
      <Block className="sk-heading" />
      <div className="sk-field-grid">
        <Block className="sk-field" />
        <Block className="sk-field" />
        <Block className="sk-field" />
        <Block className="sk-field" />
        <Block className="sk-field" />
        <Block className="sk-field" />
      </div>
      <Block className="sk-section" />
    </div>
  );
}

function SkeletonC() {
  return (
    <div className="sk sk-c" aria-hidden="true">
      <Block className="sk-run-header" />
      <Block className="sk-stage-bar" />
      <Block className="sk-row" />
      <Block className="sk-row" />
      <Block className="sk-section" />
    </div>
  );
}

function SkeletonD() {
  return (
    <div className="sk sk-d" aria-hidden="true">
      <Block className="sk-toolbar" />
      <div className="sk-split">
        <div className="sk-split-side">
          <Block className="sk-row" />
          <Block className="sk-row" />
          <Block className="sk-row" />
        </div>
        <div className="sk-split-main">
          <Block className="sk-heading" />
          <Block className="sk-section" />
          <Block className="sk-section" />
        </div>
      </div>
    </div>
  );
}

function SkeletonE() {
  return (
    <div className="sk sk-e" aria-hidden="true">
      <Block className="sk-heading" />
      <Block className="sk-summary" />
      <div className="sk-split">
        <div className="sk-split-main">
          <Block className="sk-section" />
          <Block className="sk-section" />
        </div>
        <div className="sk-split-side">
          <Block className="sk-section" />
        </div>
      </div>
    </div>
  );
}

function SkeletonAG() {
  return (
    <div className="sk sk-ag" aria-hidden="true">
      <Block className="sk-heading" />
      <Block className="sk-message" />
      <Block className="sk-message sk-message--alt" />
      <Block className="sk-message" />
      <Block className="sk-toolbar" />
    </div>
  );
}

export function SkeletonView({ kind }: { kind: SkeletonKind }) {
  if (kind === 'A') return <SkeletonA />;
  if (kind === 'B') return <SkeletonB />;
  if (kind === 'C') return <SkeletonC />;
  if (kind === 'D') return <SkeletonD />;
  if (kind === 'E') return <SkeletonE />;
  if (kind === 'AG') return <SkeletonAG />;
  return (
    <div className="sk sk-composite" aria-hidden="true">
      <div className="sk-split">
        <div className="sk-split-side">
          <SkeletonA />
        </div>
        <div className="sk-split-main">{kind === 'A+C' ? <SkeletonC /> : <SkeletonB />}</div>
      </div>
    </div>
  );
}
