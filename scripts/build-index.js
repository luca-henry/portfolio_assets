// Scans /projects, reads each info.txt + media, writes projects/projects.json
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "projects");
const IMG = /\.(png|jpe?g|webp|gif|avif|svg)$/i, VID = /\.(mp4|webm|mov)$/i, PDF = /\.pdf$/i, AUD = /\.(mp3|m4a|aac|wav|ogg|opus)$/i;
const type = f => IMG.test(f) ? "image" : VID.test(f) ? "video" : PDF.test(f) ? "pdf" : AUD.test(f) ? "audio" : null;
const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const url = (...p) => p.map(s => encodeURIComponent(s)).join("/");

// Reads an image's width/height straight from the file header (jpg, png, gif, webp). Written into projects.json as "ratio" so the site never has to wait for an image to load to know its shape.
function imgRatio(file) {
  try {
    const fd = fs.openSync(file, "r"), head = Buffer.alloc(32); fs.readSync(fd, head, 0, 32, 0);
    let w = 0, h = 0, rot = false;
    if (head.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { w = head.readUInt32BE(16); h = head.readUInt32BE(20); }
    else if (head.toString("latin1", 0, 3) === "GIF") { w = head.readUInt16LE(6); h = head.readUInt16LE(8); }
    else if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") {
      const t = head.toString("latin1", 12, 16);
      if (t === "VP8 ") { w = head.readUInt16LE(26) & 0x3fff; h = head.readUInt16LE(28) & 0x3fff; }
      else if (t === "VP8L") { const b = head.readUInt32LE(21); w = (b & 0x3fff) + 1; h = ((b >> 14) & 0x3fff) + 1; }
      else if (t === "VP8X") { w = 1 + (head[24] | head[25] << 8 | head[26] << 16); h = 1 + (head[27] | head[28] << 8 | head[29] << 16); }
    } else if (head[0] === 0xff && head[1] === 0xd8) {
      const buf = fs.readFileSync(file); let p = 2;
      while (p + 9 < buf.length) {
        if (buf[p] !== 0xff) { p++; continue; }
        const m = buf[p + 1], len = buf.readUInt16BE(p + 2);
        if (m === 0xe1 && buf.toString("latin1", p + 4, p + 8) === "Exif") {   // EXIF orientation 5-8 means the browser shows the photo turned on its side
          const t = p + 10, le = buf.toString("latin1", t, t + 2) === "II", u16 = o => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o), u32 = o => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
          const ifd = t + u32(t + 4), n = u16(ifd);
          for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === 0x0112) { const o = u16(e + 8); rot = o >= 5 && o <= 8; } }
        }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = buf.readUInt16BE(p + 5); w = buf.readUInt16BE(p + 7); break; }
        p += 2 + len;
      }
    }
    fs.closeSync(fd);
    if (!(w > 0 && h > 0)) return 0;
    return Math.round((rot ? h / w : w / h) * 10000) / 10000;
  } catch (e) { return 0; }
}

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
        files.push({ name: f, src: "projects/" + url(d.name, ...(sub ? [sub] : []), f), type: type(f), size: fs.statSync(path.join(p, f)).size, ratio: type(f) === "image" && !/\.svg$/i.test(f) ? imgRatio(path.join(p, f)) : 0 });
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
  // info.txt:  tvscreen: 12.7,8.1 87.4,8.1 87.4,69.3 12.7,69.3   (the four corners of the TV screen as % of the photo: top-left, top-right, bottom-right, bottom-left)
  //            glow: 0.22                         (how strong the light spilling from the TV is, 0 to 1)
  //            tvpower: 60.5,81                   (where the TV's own power button is, as % of the photo; optional)
  let tv = null, tvUsed = new Set();
  if (/tv/i.test(meta.format || "")) {
    const photo = files.find(f => f.type === "image" && !isCover(f)), video = files.find(f => f.type === "video");
    const nums = (meta.tvscreen || "").match(/-?\d+(\.\d+)?/g);
    tv = { photo: photo ? photo.src : "", video: video ? video.src : "", screen: nums && nums.length === 8 ? nums.map(Number) : [12.7, 8.1, 87.4, 8.1, 87.4, 69.3, 12.7, 69.3], glow: meta.glow !== undefined && meta.glow !== "" ? Number(meta.glow) : 0.6 };
    const pn = (meta.tvpower || "").match(/-?\d+(\.\d+)?/g); if (pn && pn.length === 2) tv.power = pn.map(Number);
    if (photo) tvUsed.add(photo); if (video) tvUsed.add(video);
    if (!photo) console.warn(`NOTE: ${d.name} has format: tv but no photo yet (put an image in the folder)`);
    if (!video) console.warn(`NOTE: ${d.name} has format: tv but no video yet`);
  }
  // Magazine poster that can be ripped out (format: booklet). Files: poster.jpg = the big poster, torn-1.jpg / torn-2.jpg = the left and right page left behind once it is gone.
  // info.txt:  rip: 30   (the page the RIP ME poster is on; it and the next page are the pair that gets torn out)
  let poster = null, audio = null, bookPages = null, posterUsed = new Set();
  if (/book/i.test(meta.format || "")) {
    const base = f => path.basename(f.src);
    const po = files.find(f => f.type === "image" && /^poster[-_. ]/i.test(base(f)));
    const torn = files.filter(f => f.type === "image" && /^torn[-_. ]/i.test(base(f)));
    if (po) { poster = { src: po.src, page: Number(meta.rip) || 30, torn: torn.map(f => f.src) }; posterUsed.add(po); }
    torn.forEach(f => posterUsed.add(f));
    // Boombox that plays the magazine's audio. Files: audio.mp3 (any .mp3 .m4a .wav .ogg) = the sound, boombox.png = the picture of the boombox. It floats in the corner of the page and toggles play / pause.
    // The pages of the magazine are the files named page-01.jpg, page-02.jpg ... in order (when there are none named like that, every image in the folder is a page). Any other image in the folder (boombox.png, poster.jpg, torn-1.jpg, a stray file) can never turn up as a page.
    const pg = files.filter(f => f.type === "image" && /^page[-_. ]?\d/i.test(base(f)));
    if (pg.length > 1) bookPages = pg.map(({ src, ratio }) => ({ src, type: "image", ...(ratio ? { ratio } : {}) }));
    const au = files.find(f => f.type === "audio"), bx = files.find(f => f.type === "image" && /^boombox([-_. ]|$)/i.test(base(f)));
    if (au && bx) {
      audio = { src: au.src, boombox: bx.src }; posterUsed.add(au); posterUsed.add(bx);
      const mb = au.size / 1048576;
      if (mb > 25) console.warn(`WARNING: ${d.name} audio is ${mb.toFixed(1)} MB, over Cloudflare's 25 MB per-file limit - compress it`);
    } else if (au) console.warn(`NOTE: ${d.name} has audio but no boombox.png`);
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
    ...(poster ? { poster } : {}),
    ...(audio ? { audio } : {}),
    ...(bookPages ? { pages: bookPages } : {}),
    ...(meta.tone ? { tone: meta.tone } : {}),
    ...(model ? { model, ...(mtl ? { modelmtl: mtl } : {}), ...(texture ? { modeltexture: texture } : {}), ...(meta.modelrotate ? { modelrotate: meta.modelrotate } : {}) } : {}),
    ...(meta.format ? { format: meta.format } : {}),   // format: booklet  turns the project into a flip-through book
    media: files.filter(f => !isCover(f) && !used.has(f) && !tableUsed.has(f) && !fridgeUsed.has(f) && !tvUsed.has(f) && !posterUsed.has(f) && f.type !== "audio").map(({ src, type, ratio }) => ({ src, type, ...(ratio ? { ratio } : {}) }))
  });
}
projects.sort((a, b) => a.order - b.order || nat(a.title, b.title));
fs.writeFileSync(path.join(ROOT, "projects.json"), JSON.stringify({ projects }, null, 2));
console.log(`projects.json: ${projects.length} project(s)`);
