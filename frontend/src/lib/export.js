import { safeFileName } from "./format.js";

export function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// 将思维导图 SVG 以 2x 分辨率导出为 PNG。svgEl 为 DOM 中的 <svg> 元素。
export function exportMindmapPng(svgEl, title, toast) {
  if (!svgEl) return toast("思维导图还没生成好");
  const w = +svgEl.getAttribute("width"), h = +svgEl.getAttribute("height");
  const xml = new XMLSerializer().serializeToString(svgEl);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w * 2; canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => {
      if (b) downloadBlob(`${safeFileName(title)}-思维导图.png`, b);
      else toast("导出失败了，再试一次");
    }, "image/png");
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("导出失败了，再试一次"); };
  img.src = url;
}