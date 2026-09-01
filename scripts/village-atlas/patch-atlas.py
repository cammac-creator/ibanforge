#!/usr/bin/env python3
"""Pipeline JOUR v4 — reconstruit l'atlas depuis SES PROPRES frames (les sprites source ont
disparu du disque) + remplace maisons/tour par les découpes JOUR v3, adoucit
le sol (item 5), et rend une prévisualisation du nouveau plan (item 6)."""
import json, os, numpy as np
from PIL import Image, ImageDraw, ImageEnhance
SP=os.path.dirname(os.path.abspath(__file__)); PUB=os.path.abspath(f"{SP}/../../frontend/public/village")
L=Image.LANCZOS

atlas=Image.open(f"{PUB}/atlas.png").convert("RGBA")
meta=json.load(open(f"{PUB}/atlas.json"))
frames={n:atlas.crop((f["x"],f["y"],f["x"]+f["w"],f["y"]+f["h"])) for n,f in meta.items()}

def at(p,h):
    im=Image.open(f"{SP}/out/{p}").convert("RGBA")
    return im.resize((max(1,round(im.width*h/im.height)),h),L)
frames["house0"]=at("day-house0.png",100)
frames["house1"]=at("day-house1.png",100)
frames["house2"]=at("day-house2.png",100)
frames["house3"]=at("day-house3.png",100)
frames["house4"]=at("day-house1.png",100)      # compat
frames["house-big"]=at("day-house2.png",150)
frames["tower"]=at("day-tower.png",170)

# repack (rangées par hauteur décroissante, même algo que build-atlas-day)
order=sorted(frames,key=lambda n:-frames[n].height)
W=1400; x=y=rh=0; pos={}
for n in order:
    s=frames[n]
    if x+s.width+2>W: x=0; y+=rh+2; rh=0
    pos[n]=(x,y); rh=max(rh,s.height); x+=s.width+2
H=y+rh+2
out=Image.new("RGBA",(W,H),(0,0,0,0)); m2={}
for n,s in frames.items():
    px,py=pos[n]; out.paste(s,(px,py)); m2[n]={"x":px,"y":py,"w":s.width,"h":s.height}
out.save(f"{SP}/out/atlas-new.png",optimize=True)
json.dump(m2,open(f"{SP}/out/atlas-new.json","w"),separators=(",",":"))
print("atlas:",W,"x",H,len(m2),"sprites")

# sol plus discret (item 5) : -saturation, +clarté, -contraste
g=Image.open(f"{PUB}/ground.png").convert("RGB")
g=ImageEnhance.Color(g).enhance(0.45)
g=ImageEnhance.Brightness(g).enhance(1.12)
g=ImageEnhance.Contrast(g).enhance(0.78)
g=Image.blend(g, Image.new("RGB", g.size, (238,228,204)), 0.14)
# aplatir le contraste LOCAL (joints de pierres) : c'est lui qui rend le sol
# bavard, bien plus que la saturation — flou lourd + retour partiel du détail
from PIL import ImageFilter
gb=g.filter(ImageFilter.GaussianBlur(9))
ga=np.asarray(g).astype(np.float32); gba=np.asarray(gb).astype(np.float32)
g=Image.fromarray(np.clip(gba+(ga-gba)*0.52,0,255).astype(np.uint8))
g=g.resize((208,208),L)   # période plus large = répétition moins lisible
g.save(f"{SP}/out/ground-new.png",optimize=True)

# ---- prévisualisation du plan (item 6) ----
LAYOUT=[  # (sprite, cx, base, flip, scale)
 ("warehouse",84,106,0,1),("cart",172,96,0,1),("sacks",214,90,0,1),
 ("gate",80,182,0,1),("stall-red",196,180,0,1),("stall-teal",306,180,0,1),("library",414,176,0,0.92),
 # ruelle des registres : largeurs réelles, pas de pas fixe
 ("house0",None,120,0,1),("house1",None,120,0,1),("house2",None,120,0,1),
 ("house3",None,120,0,1),("house1",None,120,1,1),("house3",None,120,1,1),
 ("tower",170,332,0,1),("fence",296,328,0,1),
 ("fence",430,350,0,1),("signpost",470,338,0,1),
 ("house1",604,334,0,1.12),("house-big",744,338,0,1),("house3",884,334,1,1.12),
 ("desk-day",250,484,0,1),("forge",430,488,0,1),
 ("well",640,478,0,1),("barrel-group",712,470,0,1),("tree2",790,486,0,1),("hay",860,500,0,1),
 ("vigil-booth",906,476,0,1),
 ("tree1",34,152,0,1),("tree1",62,394,0,1),("grove",300,296,0,1),
 ("tree2",938,246,0,1),("tree1",386,88,0,1),("rocks",352,246,0,1),
]
# positions cumulées de la ruelle
xs=516; lane=[]
for i,(n,cx,b,fl,sc) in enumerate(LAYOUT):
    if cx is None:
        w=m2[n]["w"]*sc; lane.append(xs+w/2); LAYOUT[i]=(n,xs+w/2,b,fl,sc); xs+=w+6
print("ruelle cx:",[round(c) for c in lane]," fin:",round(xs))
gt=Image.open(f"{SP}/out/ground-new.png"); T=gt.width
prev=Image.new("RGB",(960,540))
gt180=gt.transpose(Image.ROTATE_180)
for j in range(0,540,T):
    for i in range(0,960,T): prev.paste(gt180 if ((i//T)+(j//T))%2 else gt,(i,j))
ov=Image.new("RGBA",prev.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
BANDS=[(-4,180,968,24),(920,180,24,174),(190,330,754,24),(190,330,24,192),(190,486,774,24),(-4,64,908,24)]
BANDS+= [(round(c)-5,132,10,52) for c in lane]   # allées de portes des registres
for xx,yy,ww,hh in BANDS:
    d.rectangle([xx,yy,xx+ww-1,yy+hh-1],fill=(134,104,72,96))
prev=Image.alpha_composite(prev.convert("RGBA"),ov).convert("RGB")
ents=sorted(LAYOUT,key=lambda e:e[2])
for n,cx,b,fl,sc in ents:
    f=m2[n]; s=frames[n].resize((round(f["w"]*sc),round(f["h"]*sc)),L)
    if fl: s=s.transpose(Image.FLIP_LEFT_RIGHT)
    prev.paste(s,(round(cx-s.width/2),round(b-s.height)),s)
prev=prev.resize((1440,810),Image.NEAREST)
prev.save(f"{SP}/out/layout-preview.png")
print("layout-preview écrit")
