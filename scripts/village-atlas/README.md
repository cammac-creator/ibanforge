# Village atlas pipeline (/live)

Turns the Midjourney art boards into `frontend/public/village/`:

1. Drop the boards (PNG, plain uniform backdrop) into a work dir as
   `boards/<name>.png` next to these scripts.
2. `python3 segment.py <name>...` — flood-fills the backdrop from the borders
   (the MJ backdrops are flat: sum-distance tolerance 14), cuts connected
   components into `sprites/<name>/NN.png`, and writes a numbered contact
   sheet per board under `sheets/` for naming the pieces.
3. Edit the RECIPE/LAYOUT tables in `build-atlas.py` (source piece → target
   height; LANCZOS wins over NEAREST/BOX at these scales — verified visually),
   then `python3 build-atlas.py` → `out/atlas.png` + `out/atlas.json` +
   a full village layout preview to review before touching the engine.
4. Copy `out/atlas.png`, `out/atlas.json`, `out/ground.png` into
   `frontend/public/village/`.

Requires Pillow + numpy. The boards themselves stay OUT of the repo (heavy,
and the artist's raw exports); only the packed atlas ships.
