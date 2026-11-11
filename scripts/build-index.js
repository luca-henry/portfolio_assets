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

  // fold-out poster: info.txt lines  fold: calendar.jpg / cols: 6 / rows: 4 / zoom: calendar-hires.jpg (optional)
  const byName = n => n && files.find(f => f.name.toLowerCase() === n.toLowerCase());
  const foldFile = byName(meta.fold), zoomFile = byName(meta.zoom);
  const used = new Set([foldFile, zoomFile].filter(Boolean));
  const fold = foldFile ? { src: foldFile.src, cols: Number(meta.cols) || 6, rows: Number(meta.rows) || 4, ...(zoomFile ? { zoom: zoomFile.src } : {}) } : null;
  if (meta.fold && !foldFile) console.warn(`WARNING: ${d.name}/info.txt says fold: ${meta.fold} but that file was not found`);
  // table-top spread (format: table): files named menu-front/back, tee-front/back, box-front/back/left/right/top/bottom; every other image becomes a print on the table
  let table = null, tableUsed = new Set();
  if (/table/i.test(meta.format || "")) {
    table = { tint: meta.tint || "", menu: {}, tee: {}, box: {}, prints: [] };
    for (const f of files) {
      const m = path.parse(f.name).name.toLowerCase().match(/^(menu|tee|box)[-_ ](front|back|left|right|top|bottom)$/);
      if (m && f.type === "image") { table[m[1]][m[2]] = f.src; tableUsed.add(f); }
    }
    table.prints = files.filter(f => f.type === "image" && !isCover(f) && !tableUsed.has(f)).map(f => f.src);
    files.forEach(f => tableUsed.add(f));
  }
  // fridge (format: fridge): files named item-1-steak.webp, item-2-sausages.webp are the packs in the fridge; every other image/video (20-logo-animation.mp4, 30-posters.jpg ...) becomes a slide in the viewer, in file-name order
  let fridge = null, fridgeUsed = new Set();
  if (/fridge/i.test(meta.format || "")) {
    const cap = nm => { const t = nm.replace(/^item[-_ ]/i, "").replace(/^\d+[-_ ]*/, "").split(/[-_ ]+/).filter(x => x && !/^\d+$/.test(x)); const c = w => w.charAt(0).toUpperCase() + w.slice(1); return t.length > 1 && !/^item/i.test(nm) ? c(t[0]) + " / " + t.slice(1).join(" ") : c(t.join(" ")); };
    fridge = { items: [], slides: [] };
    for (const f of files) {
      if (isCover(f) || !(f.type === "image" || f.type === "video")) continue;
      const nm = path.parse(f.name).name;
      if (/^bg[-_ ]/i.test(nm) && f.type === "image") { fridge.bg = f.src; fridgeUsed.add(f); continue; }
      if (/^item[-_ ]/i.test(nm) && f.type === "image") fridge.items.push({ src: f.src, caption: cap(nm) });
      else fridge.slides.push({ src: f.src, type: f.type, caption: cap(nm) });
      fridgeUsed.add(f);
    }
    fridge.slides = [...fridge.items.map(i => ({ src: i.src, type: "image", caption: i.caption })), ...fridge.slides];
  }
  // TV in a photo (format: tv): the first image in the folder is the room photo, the first video is the film.
  // info.txt:  tvscreen: 31,30 69,30 69,58 31,58   (the four corners of the TV screen as % of the photo: top-left, top-right, bottom-right, bottom-left)
  //            glow: 0.22                         (how strong the light spilling from the TV is, 0 to 1)
  let tv = null, tvUsed = new Set();
  if (/tv/i.test(meta.format || "")) {
    const photo = files.find(f => f.type === "image" && !isCover(f)), video = files.find(f => f.type === "video");
    const nums = (meta.tvscreen || "").match(/-?\d+(\.\d+)?/g);
    tv = { photo: photo ? photo.src : "", video: video ? video.src : "", screen: nums && nums.length === 8 ? nums.map(Number) : [31, 30, 69, 30, 69, 58, 31, 58], glow: meta.glow !== undefined && meta.glow !== "" ? Number(meta.glow) : 0.22 };
    if (photo) tvUsed.add(photo); if (video) tvUsed.add(video);
    if (!photo) console.warn(`NOTE: ${d.name} has format: tv but no photo yet (put an image in the folder)`);
    if (!video) console.warn(`NOTE: ${d.name} has format: tv but no video yet`);
  }
  // 3D model: info.txt  model: ring.glb   (.glb .gltf .obj .fbx .stl)   optional:  modelrotate: 0 90 0   modeltexture: ring-texture.png
  // textures that sit next to a .gltf / .fbx / .obj+.mtl are found automatically (keep every file in the same folder as the model)
  const findIn = name => { if (!name) return null; for (const sub of ["", "images", "model"]) { const f = path.join(dir, sub, name); if (fs.existsSync(f)) return "projects/" + url(d.name, ...(sub ? [sub] : []), name); } return null; };
  const model = findIn(meta.model), texture = findIn(meta.modeltexture);
  let mtl = null;
  if (model && /\.obj$/i.test(meta.model)) {
    mtl = findIn(meta.modelmtl || meta.model.replace(/\.obj$/i, ".mtl"));
    if (!mtl) { const only = fs.readdirSync(dir).filter(f => /\.mtl$/i.test(f)); if (only.length === 1) mtl = findIn(only[0]); }   // a single .mtl in the folder is used even if it is named differently
  }
  if (meta.model && !model) console.warn(`WARNING: ${d.name}/info.txt says model: ${meta.model} but that file was not found`);
  if (meta.modeltexture && !texture) console.warn(`WARNING: ${d.name}/info.txt says modeltexture: ${meta.modeltexture} but that file was not found`);
  projects.push({
    slug: d.name,
    title: meta.title || d.name.replace(/[-_]+/g, " "),
    category: meta.category || "",
    order: Number(meta.order) || 999,
    note: meta.note || "",
    body,
    cover: cover && cover.src,
    ...(fold ? { fold } : {}),
    ...(table ? { table } : {}),
    ...(fridge ? { fridge } : {}),
    ...(tv ? { tv } : {}),
    ...(meta.tone ? { tone: meta.tone } : {}),
    ...(model ? { model, ...(mtl ? { modelmtl: mtl } : {}), ...(texture ? { modeltexture: texture } : {}), ...(meta.modelrotate ? { modelrotate: meta.modelrotate } : {}) } : {}),
    ...(meta.format ? { format: meta.format } : {}),   // format: booklet  turns the project into a flip-through book
    media: files.filter(f => !isCover(f) && !used.has(f) && !tableUsed.has(f) && !fridgeUsed.has(f) && !tvUsed.has(f)).map(({ src, type }) => ({ src, type }))
  });
}
projects.sort((a, b) => a.order - b.order || nat(a.title, b.title));
fs.writeFileSync(path.join(ROOT, "projects.json"), JSON.stringify({ projects }, null, 2));
console.log(`projects.json: ${projects.length} project(s)`);
