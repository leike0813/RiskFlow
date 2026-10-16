import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  SourceOriginalInfoV1Schema,
  type SourceOriginalInfoV1,
  type SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import { readSourceOriginalBytes, sourceOriginalPath, submitQuery } from "../api/client.js";
import { useEngineering } from "../api/engineering.js";
import type { KindRef } from "../api/operations.js";
import "./DocumentOriginalView.css";

GlobalWorkerOptions.workerSrc = pdfWorker;

function PdfOriginal({ bytes }: { readonly bytes: Uint8Array }) {
  const [searchParams] = useSearchParams();
  const initialPage = Number(searchParams.get("page") ?? 1);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(
    Number.isSafeInteger(initialPage) && initialPage >= 1 ? initialPage : 1,
  );
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [text, setText] = useState("");
  const textContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const task = getDocument({
      data: bytes.slice(),
      cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
      wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
    });
    let active = true;
    void task.promise.then(
      (value) => {
        if (active) {
          setPage((v) => Math.min(v, value.numPages));
          setDocument(value);
        }
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
      void task.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    if (document === undefined) return;
    let active = true;
    let cancel: (() => void) | undefined;
    void document
      .getPage(page)
      .then(async (value) => {
        if (!active || canvas.current === null) return;
        const viewport = value.getViewport({ scale: zoom });
        const target = canvas.current;
        target.width = viewport.width;
        target.height = viewport.height;
        const context = target.getContext("2d");
        if (context === null) return;
        const rendering = value.render({ canvas: target, canvasContext: context, viewport });
        let layer: TextLayer | undefined;
        cancel = () => {
          rendering.cancel();
          layer?.cancel();
        };
        const content = await value.getTextContent();
        if (active) {
          setText(content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" "));
          if (textContainer.current !== null) {
            textContainer.current.replaceChildren();
            textContainer.current.style.setProperty("--scale-factor", String(zoom));
            textContainer.current.style.setProperty("--total-scale-factor", String(zoom));
            layer = new TextLayer({
              textContentSource: content,
              container: textContainer.current,
              viewport,
            });
            await layer.render();
          }
        }
        await rendering.promise;
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      cancel?.();
    };
  }, [document, page, zoom]);
  if (error) return <p role="alert">原件预览失败，可下载原文件查看。</p>;
  return (
    <div>
      <div className="original-toolbar">
        <button type="button" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
          上一页
        </button>
        <span>{document === undefined ? "加载中" : `${page} / ${document.numPages}`}</span>
        <button
          type="button"
          disabled={document === undefined || page >= document.numPages}
          onClick={() => setPage((v) => v + 1)}
        >
          下一页
        </button>
        <button type="button" disabled={zoom <= 0.5} onClick={() => setZoom((v) => v - 0.25)}>
          缩小
        </button>
        <button type="button" disabled={zoom >= 2} onClick={() => setZoom((v) => v + 0.25)}>
          放大
        </button>
      </div>
      <div className="original-pages">
        <div className="original-pdf-page">
          <canvas ref={canvas} aria-label={`原件第 ${page} 页`} />
          <div ref={textContainer} className="textLayer" />
        </div>
        {text === "" ? null : (
          <details>
            <summary>本页文本</summary>
            <p>{text}</p>
          </details>
        )}
      </div>
    </div>
  );
}

export function DocumentOriginalView({ sourceVersionRef }: { readonly sourceVersionRef: KindRef }) {
  const { selector } = useEngineering();
  const [info, setInfo] = useState<SourceOriginalInfoV1>();
  const [url, setUrl] = useState<string>();
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const [imageZoom, setImageZoom] = useState(1);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array>();
  useEffect(() => {
    if (selector.projectId === null) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setInfo(undefined);
    setUrl(undefined);
    setText(undefined);
    setError(undefined);
    setPdfBytes(undefined);
    void (async () => {
      const value = SourceOriginalInfoV1Schema.parse(
        await submitQuery({
          projectId: selector.projectId!,
          branch: "engineering-data.source-original-read",
          sourceVersionRefs: [sourceVersionRef as SourceVersionRefV1],
          payload: { sourceVersionRef },
          signal: controller.signal,
        }),
      );
      controller.signal.throwIfAborted();
      setInfo(value);
      if (value.previewKind === "download") return;
      const blob = await readSourceOriginalBytes({
        projectId: selector.projectId!,
        sourceId: sourceVersionRef.reference.entityId,
        versionId: sourceVersionRef.reference.versionId,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (value.previewKind === "pdf") {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        controller.signal.throwIfAborted();
        setPdfBytes(bytes);
      } else if (value.previewKind === "text") {
        const bytes = await blob.arrayBuffer();
        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        controller.signal.throwIfAborted();
        setText(content);
      } else {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }
    })().catch((cause) => {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "READ_FAILED");
    });
    return () => {
      controller.abort();
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [
    selector.projectId,
    sourceVersionRef.reference.entityId,
    sourceVersionRef.reference.versionId,
  ]);
  const href =
    selector.projectId === null
      ? undefined
      : `${sourceOriginalPath(selector.projectId, sourceVersionRef.reference.entityId, sourceVersionRef.reference.versionId)}?disposition=attachment`;
  return (
    <section aria-label="资料原件" className="original-view">
      {info === undefined ? (
        <p>{error === undefined ? "正在读取原件信息…" : "无法读取原件，请检查权限或稍后重试。"}</p>
      ) : (
        <>
          <dl>
            <dt>文件</dt>
            <dd>{info.originalFileName ?? `${info.sourceName}（未登记原文件名）`}</dd>
            <dt>类型与大小</dt>
            <dd>
              {info.mediaType} · {info.byteLength} 字节
            </dd>
          </dl>
          <dl>
            <dt>登记者</dt>
            <dd>{info.registeredBy}</dd>
            <dt>登记时间</dt>
            <dd>{info.registeredAt}</dd>
            <dt>来源</dt>
            <dd>{info.deliveryKind === "file-upload" ? "上传原件" : "导入快照"}</dd>
          </dl>
          <a href={href} download>
            下载原件
          </a>
          {info.previewKind === "download" ? <p>此格式请下载原文件，使用本机软件打开。</p> : null}
          {error !== undefined ? (
            <p role="alert">无法预览原件，请下载原文件查看。</p>
          ) : info.previewKind === "text" && text !== undefined ? (
            <pre>{text}</pre>
          ) : info.previewKind === "image" && url !== undefined ? (
            <div>
              <div className="original-toolbar">
                <button
                  type="button"
                  disabled={imageZoom <= 0.5}
                  onClick={() => setImageZoom((v) => v - 0.25)}
                >
                  缩小
                </button>
                <button
                  type="button"
                  disabled={imageZoom >= 2}
                  onClick={() => setImageZoom((v) => v + 0.25)}
                >
                  放大
                </button>
              </div>
              <div className="original-pages">
                <img
                  src={url}
                  alt={info.sourceName}
                  style={{ width: `${imageZoom * 100}%`, maxWidth: "none" }}
                />
              </div>
            </div>
          ) : info.previewKind === "pdf" && pdfBytes !== undefined ? (
            <PdfOriginal bytes={pdfBytes} />
          ) : null}
        </>
      )}
    </section>
  );
}
