// Scans /projects, reads each info.txt + media, writes projects/projects.json
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "projects");
const IMG = /\.(png|jpe?g|webp|gif|avif|svg)$/i, VID = /\.(mp4|webm|mov)$/i, PDF = /\.pdf$/i;
const type = f => IMG.test(f) ? "image" : VID.test(f) ? "video" : PDF.test(f) ? "pdf" : null;
const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const url = (...p) => p.map(s => encodeURIComponent(s)).join("/");

function parseInfo(txt) {
  const lines = txt.replace(/\r/g, "").split("\n"), meta = {};
  let i = 0;
  for (; i < lines.length && lines[i].trim() !== "---"; i++) {
    const m = lines[i].match(/^\s*([a-z]+)\s*:\s*(.*)$/i);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  }
  return { meta, body: lines.slice(i + 1).join("\n").trim() };
}

const projects = [];
for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const dir = path.join(ROOT, d.name), info = path.join(dir, "info.txt");
  if (!fs.existsSync(info)) continue;
  const { meta, body } = parseInfo(fs.readFileSync(info, "utf8"));

  // media may sit in the project folder or in an images/ subfolder
  const files = [];
  for (const sub of ["", "images"]) {
    const p = path.join(dir, sub);
    if (!fs.existsSync(p)) continue;
    for (const f of fs.readdirSync(p).sort(nat))
      if (type(f) && fs.statSync(path.join(p, f)).isFile())
        files.push({ name: f, src: "projects/" + url(d.name, ...(sub ? [sub] : []), f), type: type(f) });
  }
  const isCover = f => path.parse(f.name).name.toLowerCase() === "cover";
  const cover = files.find(f => isCover(f) && f.type === "image") || null;
  projects.push({
    slug: d.name,
    title: meta.title || d.name.replace(/[-_]+/g, " "),
    category: meta.category || "",
    order: Number(meta.order) || 999,
    note: meta.note || "",
    body,
    cover: cover && cover.src,
    media: files.filter(f => !isCover(f)).map(({ src, type }) => ({ src, type }))
  });
}
projects.sort((a, b) => a.order - b.order || nat(a.title, b.title));
fs.writeFileSync(path.join(ROOT, "projects.json"), JSON.stringify({ projects }, null, 2));
console.log(`projects.json: ${projects.length} project(s)`);
