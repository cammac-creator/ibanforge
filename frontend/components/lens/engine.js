import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function creerBraise(hote, signaler) {
  if (new URLSearchParams(location.search).has('sans3d')) throw new Error('Vue fixe demandée');
  const mobile = matchMedia('(max-width:700px)').matches;
  const mouvementReduit = matchMedia('(prefers-reduced-motion:reduce)').matches;
  const clamp = THREE.MathUtils.clamp,
    TAU = Math.PI * 2;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  renderer.setClearColor('#120f0d');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  hote.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#120f0d');
  scene.fog = new THREE.Fog('#120f0d', 19, 36);
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 65);
  const studio = new THREE.Scene();
  studio.background = new THREE.Color('#343639');
  for (const [x, y, z, w, h, c, p] of [
    [3, 4, -7, 3.4, 5, '#fff5e7', 1.15],
    [6, 1, -3, 0.42, 7, '#edf3ff', 1.6],
    [-4, 5, -5, 5, 1.2, '#e8f0ff', 1.15],
    [-5, -1, 4, 2.8, 4, '#cc8f66', 0.65],
    [1, -4, -2, 4, 1, '#f5d2ad', 0.7],
  ]) {
    const plan = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(c).multiplyScalar(p),
        side: THREE.DoubleSide,
      }),
    );
    plan.position.set(x, y, z);
    plan.lookAt(0, 0, 0);
    studio.add(plan);
  }
  const pmrem = new THREE.PMREMGenerator(renderer),
    env = pmrem.fromScene(studio, 0.025);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.72;
  pmrem.dispose();
  studio.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  function lumiere(c, f, x, y, z) {
    const l = new THREE.DirectionalLight(c, f);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  }
  const cle = lumiere('#fff2dd', 1.3, 5, 6, 5);
  cle.castShadow = true;
  cle.shadow.mapSize.set(1024, 1024);
  Object.assign(cle.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
  cle.shadow.bias = -0.001;
  cle.shadow.normalBias = 0.025;
  lumiere('#dce7fa', 0.7, 3, 3, -5);
  lumiere('#d29e74', 0.7, -4, -1, 4);
  scene.add(new THREE.HemisphereLight('#dfd9d0', '#1c1713', 0.34));
  const balayage = new THREE.SpotLight('#ffe8cb', 7, 22, 0.32, 0.85, 2);
  balayage.position.set(5, 4, 6);
  balayage.target.position.set(0, 0.2, 0);
  scene.add(balayage, balayage.target);
  const coeur = new THREE.PointLight('#ffc392', 2.1, 6, 2);
  coeur.position.set(0.15, 0, 0.35);
  scene.add(coeur);
  const objet = new THREE.Group();
  scene.add(objet);
  function mesh(geo, mat, g = objet) {
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    return m;
  }
  function brossage() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d'),
      p = x.createImageData(256, 256);
    let n = 6421;
    for (let y = 0; y < 256; y++) {
      n = (n * 16807) % 2147483647;
      const ligne = n % 22;
      for (let z = 0; z < 256; z++) {
        n = (n * 16807) % 2147483647;
        const v = 115 + ligne + (n % 13);
        p.data.set([v, v, v, 255], (y * 256 + z) * 4);
      }
    }
    x.putImageData(p, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const texture = brossage();
  const cuivre = new THREE.MeshPhysicalMaterial({
    color: '#98765c',
    metalness: 1,
    roughness: 0.56,
    roughnessMap: texture,
    bumpMap: texture,
    bumpScale: 0.0012,
    anisotropy: 0.48,
    anisotropyRotation: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.2,
  });
  const poli = new THREE.MeshPhysicalMaterial({
    color: '#c8a585',
    metalness: 1,
    roughness: 0.25,
    envMapIntensity: 0.8,
  });
  const rainure = new THREE.MeshStandardMaterial({
    color: '#302924',
    metalness: 0.85,
    roughness: 0.43,
    envMapIntensity: 0.7,
  });
  const rayonVerre = 2.055,
    courbure = 6.3;
  const epaisseurVerre = (r) => 0.46 - (courbure - Math.sqrt(courbure * courbure - r * r));
  const verre = new THREE.MeshPhysicalMaterial({
    color: '#fffdf9',
    metalness: 0,
    roughness: 0.026,
    transmission: 1,
    thickness: 0.88,
    ior: 1.52,
    dispersion: mobile ? 0 : 0.035,
    attenuationColor: '#f3e9d7',
    attenuationDistance: 4.5,
    envMapIntensity: 1.05,
    specularIntensity: 1,
    clearcoat: 0,
    side: THREE.FrontSide,
  });
  // Deux calottes sphériques et une tranche fermée donnent au verre son volume réel.
  const profil = [];
  for (let i = 0; i <= 64; i++) {
    const r = (i / 64) * rayonVerre;
    profil.push(new THREE.Vector2(r, -epaisseurVerre(r)));
  }
  for (let i = 64; i >= 0; i--) {
    const r = (i / 64) * rayonVerre;
    profil.push(new THREE.Vector2(r, epaisseurVerre(r)));
  }
  const geoVerre = new THREE.LatheGeometry(profil, mobile ? 128 : 224);
  geoVerre.rotateZ(-Math.PI / 2);
  geoVerre.computeVertexNormals();
  mesh(geoVerre, verre);
  function anneau(r, t, mat, x = 0) {
    const m = mesh(new THREE.TorusGeometry(r, t, 16, mobile ? 128 : 224), mat);
    m.rotation.y = Math.PI / 2;
    m.position.x = x;
    return m;
  }
  // Profil fermé du bâti : portée du verre, épaulement, chanfreins et tranche usinée.
  const profilMetal = [
    [2.04, -0.14],
    [2.07, -0.18],
    [2.135, -0.2],
    [2.175, -0.177],
    [2.19, -0.145],
    [2.19, 0.145],
    [2.175, 0.177],
    [2.135, 0.2],
    [2.07, 0.18],
    [2.04, 0.14],
    [2.04, -0.14],
  ];
  const geoMetal = new THREE.LatheGeometry(
    profilMetal.map(([r, x]) => new THREE.Vector2(r, x)),
    mobile ? 128 : 224,
  );
  geoMetal.rotateZ(-Math.PI / 2);
  const bande = mesh(geoMetal, cuivre);
  bande.castShadow = true;
  bande.receiveShadow = true;
  for (const x of [-0.181, 0.181]) anneau(2.127, 0.025, poli, x);
  for (const x of [-0.122, 0.122]) anneau(2.049, 0.011, rainure, x);
  for (const x of [-0.105, 0.105]) anneau(2.19, 0.009, rainure, x);
  for (const x of [-0.027, 0, 0.027]) anneau(2.191, 0.003, poli, x);
  const marques = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.002, 0.009), rainure, 96),
    repere = new THREE.Object3D();
  for (let i = 0; i < 96; i++) {
    const a = (i * TAU) / 96;
    repere.position.set(0, Math.cos(a) * 2.194, Math.sin(a) * 2.194);
    repere.rotation.x = a;
    repere.scale.setScalar(i % 8 === 0 ? 1 : 0.55);
    repere.updateMatrix();
    marques.setMatrixAt(i, repere.matrix);
  }
  objet.add(marques);
  // Un chanfrein optique très fin révèle les interfaces air/verre, sans cercles décoratifs.
  const peau = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    uniforms: { force: { value: 0.055 } },
    vertexShader:
      'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
    fragmentShader:
      'varying vec3 n;varying vec3 v;uniform float force;void main(){float f=pow(1.-abs(dot(normalize(n),normalize(v))),5.);gl_FragColor=vec4(.85,.90,1.,f*force);}',
  });
  const reflet = mesh(geoVerre, peau);
  reflet.scale.setScalar(1.001);
  const bordVerre = new THREE.MeshPhysicalMaterial({
    color: '#eee6d7',
    transmission: 0.88,
    thickness: 0.025,
    ior: 1.52,
    roughness: 0.045,
    envMapIntensity: 1.2,
  });
  anneau(2.038, 0.009, bordVerre, 0.12);
  anneau(2.038, 0.009, bordVerre, -0.12);
  const sol = mesh(
    new THREE.PlaneGeometry(65, 65),
    new THREE.MeshStandardMaterial({
      color: '#151310',
      metalness: 0.18,
      roughness: 0.55,
      envMapIntensity: 0.17,
    }),
    scene,
  );
  sol.rotation.x = -Math.PI / 2;
  sol.position.y = -2.222;
  sol.receiveShadow = true;
  function textureHalo() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d'),
      g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,238,211,1)');
    g.addColorStop(0.12, 'rgba(255,191,128,.50)');
    g.addColorStop(0.5, 'rgba(216,108,49,.07)');
    g.addColorStop(1, 'rgba(154,70,25,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  const haloMap = textureHalo();
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloMap,
      color: '#ffe0b8',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  halo.position.set(0, 0, 0.2);
  halo.scale.set(1.75, 1.75, 1);
  objet.add(halo);
  const caustique = mesh(
    new THREE.PlaneGeometry(4, 3),
    new THREE.MeshBasicMaterial({
      map: haloMap,
      color: '#c87942',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    scene,
  );
  caustique.rotation.x = -Math.PI / 2;
  caustique.position.set(0.5, -2.215, 0);
  const uniforms = {
    debut: { value: -5.1 },
    temps: { value: 0 },
    energie: { value: 1 },
    phase: { value: 0 },
    sequence: { value: 0 },
  };
  function matFlux(c, segment, large = false) {
    return new THREE.ShaderMaterial({
      transparent: large,
      depthWrite: !large,
      blending: large ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        ...uniforms,
        couleur: { value: new THREE.Color(c) },
        segment: { value: segment },
        large: { value: large ? 1 : 0 },
      },
      vertexShader:
        'varying vec2 vUv;uniform float temps;uniform float segment;uniform float debut;void main(){vUv=uv;vec3 p=position;if(segment<.5)p.x+=(debut+5.1)*(1.-uv.x);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
      fragmentShader:
        'varying vec2 vUv;uniform vec3 couleur;uniform float temps;uniform float energie;uniform float phase;uniform float sequence;uniform float segment;uniform float large;void main(){float t=mod(temps*.19,1.);float point=(segment+vUv.x)/3.;float d=abs(point-t);d=min(d,1.-d);float pulse=exp(-d*d*460.);float fond=mix(.42,.12,sequence);float force=(fond+pulse*1.7)*energie;float alpha=mix(1.,.11,large);gl_FragColor=vec4(couleur*force*1.3,alpha);}',
    });
  }
  const chemins = [],
    sorties = [],
    matieres = [],
    attachements = [];
  let composition = 'traversee',
    finRaccord = 0.75,
    dernierRaccord = '',
    etats = ['attente', 'attente', 'attente'],
    survol = -1;
  function filament(points, c, segment, rayon = 0.008) {
    const courbe = new THREE.CatmullRomCurve3(points),
      m = matFlux(c, segment);
    matieres.push(m);
    const t = mesh(new THREE.TubeGeometry(courbe, 72, rayon, 6, false), m);
    const mg = matFlux(c, segment, true);
    matieres.push(mg);
    const halo = mesh(new THREE.TubeGeometry(courbe, 72, rayon * 4.5, 6, false), mg);
    if (segment === 2) attachements.push({ courbe, solide: t, halo, rayon });
    return courbe;
  }
  const couleurs = ['#fff0d7', '#ffca9f', '#d88b57'];
  // Une même direction par rayon : source → ouverture du verre → sortie parallèle.

  for (let j = 0; j < 18; j++) {
    const angle = j * 2.399963,
      rayon = j < 3 ? Math.abs(1 - j) * 1.3 : 0.5 + Math.sqrt((j - 2) / 16) * 1.12;
    const y = j < 3 ? (1 - j) * 1.3 : Math.cos(angle) * rayon,
      z = j < 3 ? 0 : Math.sin(angle) * rayon;
    const epaisseur = epaisseurVerre(Math.hypot(y, z));
    chemins.push(
      filament(
        [new THREE.Vector3(-5.1, 0, 0), new THREE.Vector3(-epaisseur, y, z)],
        j < 3 ? couleurs[j] : '#a67e5b',
        0,
        j < 3 ? 0.007 : 0.0025,
      ),
    );
    filament(
      [new THREE.Vector3(-epaisseur, y, z), new THREE.Vector3(epaisseur, y, z)],
      j < 3 ? couleurs[j] : '#8b7257',
      1,
      j < 3 ? 0.01 : 0.0025,
    );
    if (j < 3)
      sorties.push(
        filament(
          [new THREE.Vector3(epaisseur, y, 0), new THREE.Vector3(10, y, 0)],
          couleurs[j],
          2,
          0.014,
        ),
      );
  }
  // Volume de lumière : intégration d’une densité douce dans un cône, sans paroi opaque.
  const volumeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: { ...uniforms },
    vertexShader: `varying vec3 monde;void main(){vec4 p=modelMatrix*vec4(position,1.);monde=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader: `varying vec3 monde;uniform float temps;uniform float energie;uniform float debut;
    float densite(vec3 p){
      float u=(p.x-debut)/(-.24-debut);
      if(u<=0.||u>=1.)return 0.;
      float rayon=.018+u*1.86;
      float r=length(p.yz)/rayon;
      float bord=1.-smoothstep(.70,1.,r);
      float profil=exp(-1.3*r*r)*bord;
      float respiration=.97+.03*sin(temps*.8-p.x*.7);
      float grain=.985+.015*sin(p.x*48.+p.y*65.+sin(p.z*76.)+temps*.3);
      return profil*(.052+.12/(.30+u*3.))*smoothstep(0.,.07,u)*respiration*grain;
    }
    void main(){
      vec3 direction=normalize(monde-cameraPosition);
      vec3 inv=1./direction;
      vec3 a=(vec3(debut-.05,-1.91,-1.91)-cameraPosition)*inv;
      vec3 b=(vec3(-.23,1.91,1.91)-cameraPosition)*inv;
      vec3 mn=min(a,b),mx=max(a,b);
      float debut=max(max(mn.x,mn.y),mn.z),fin=min(min(mx.x,mx.y),mx.z);
      if(fin<=max(debut,0.))discard;
      debut=max(debut,0.);float pas=(fin-debut)/40.;float somme=0.;
      for(int i=0;i<40;i++){vec3 p=cameraPosition+direction*(debut+(float(i)+.5)*pas);somme+=densite(p)*pas;}
      float l=1.-exp(-somme*energie);
      gl_FragColor=vec4(vec3(1.,.66,.37)*l*1.4,1.);
    }`,
  });
  const volumeGeo = new THREE.BoxGeometry(4.92, 3.82, 3.82);
  volumeGeo.translate(-2.69, 0, 0);
  const volume = mesh(volumeGeo, volumeMat);
  volume.renderOrder = 7;
  const source = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloMap,
      color: '#fff3d9',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  source.position.set(-5.1, 0, 0);
  source.scale.set(0.65, 0.65, 1);
  objet.add(source);
  const noyau = mesh(
    new THREE.SphereGeometry(0.024, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff5dd').multiplyScalar(3) }),
  );
  noyau.position.set(-5.1, 0, 0);
  // Quelques points lumineux circulent sur les vrais chemins de la scène.
  const photonMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffe6c1').multiplyScalar(2),
    transparent: true,
    opacity: 0.85,
    toneMapped: false,
  });
  const photonGeo = new THREE.SphereGeometry(0.018, 8, 6),
    photons = new THREE.InstancedMesh(photonGeo, photonMat, 21),
    positionPhoton = new THREE.Object3D();
  photons.frustumCulled = false;
  objet.add(photons);
  const groupes = new Map();
  for (const o of [...objet.children]) {
    if (!o.material?.uniforms?.segment || o.material.uniforms.segment.value === 2) continue;
    const m = o.material,
      u = m.uniforms,
      cle = u.segment.value + '-' + u.large.value + '-' + u.couleur.value.getHexString();
    if (!groupes.has(cle)) groupes.set(cle, { geometries: [], materiau: m });
    groupes.get(cle).geometries.push(o.geometry);
    objet.remove(o);
  }
  for (const g of groupes.values()) {
    mesh(mergeGeometries(g.geometries), g.materiau);
    g.geometries.forEach((geo) => geo.dispose());
  }
  // Quelques poussières presque immobiles révèlent l’espace ; aucune gerbe d’étincelles.
  const grainsGeo = new THREE.BufferGeometry(),
    grainPos = [];
  let hasard = 531;
  for (let i = 0; i < 38; i++) {
    hasard = (hasard * 16807) % 2147483647;
    const u = 0.1 + ((hasard % 1000) / 1000) * 0.82;
    hasard = (hasard * 16807) % 2147483647;
    const angle = ((hasard % 1000) / 1000) * TAU;
    hasard = (hasard * 16807) % 2147483647;
    const rayon = Math.sqrt((hasard % 1000) / 1000) * u * 1.6;
    grainPos.push(-5.1 + u * 4.86, Math.cos(angle) * rayon, Math.sin(angle) * rayon);
  }
  grainsGeo.setAttribute('position', new THREE.Float32BufferAttribute(grainPos, 3));
  const grains = new THREE.Points(
    grainsGeo,
    new THREE.PointsMaterial({
      color: '#d8b48d',
      size: 0.009,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  objet.add(grains);
  const cible = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, cible);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.13, 0.26, 2.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let inspection = false;
  let temps = 1.9,
    actif = !mouvementReduit,
    visible = true,
    reference = false,
    raf = 0,
    dernier = performance.now(),
    mode = 'continu',
    angle = 'trois-quarts',
    intensite = 'douce',
    qualite = mobile ? 1 : 2,
    frames = 0,
    fps = 0,
    compte = 0,
    chrono = dernier,
    lent = 0,
    detruit = false;
  const projectionSource = new THREE.Matrix4();
  let sourceEcran = -0.2;
  let dernierSignal = '';
  function render() {
    if (qualite > 0) composer.render();
    else renderer.render(scene, camera);
  }
  function poserCamera() {
    const z = composition === 'console' ? 10.8 : composition === 'rayons' ? 12.7 : 11.8;
    camera.position.set(5.6, 0.75, z);
    camera.lookAt(-0.45, -0.12, 0);
    camera.zoom = inspection ? 1.25 : 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // La lentille garde son cadrage ; seule la source recule de 20 % au-delà du bord gauche.
    projectionSource.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = projectionSource.elements,
      cible = -1.4,
      x = (e[12] - cible * e[15]) / (cible * e[3] - e[0]);
    uniforms.debut.value = x;
    source.position.x = x;
    noyau.position.x = x;
    const echelle = (-x - 0.18) / 4.92;
    volume.scale.x = echelle;
    volume.position.x = 0.23 * (echelle - 1);
    const etirement = (-x - 0.24) / 4.86;
    grains.scale.x = etirement;
    grains.position.x = 0.24 * (etirement - 1);
    sourceEcran = (new THREE.Vector3(x, 0, 0).project(camera).x + 1) / 2;
  }
  // Les trois rayons se terminent exactement aux repères des données HTML.
  function pointsEcran() {
    const r = hote.getBoundingClientRect(),
      proj = (p) => {
        const v = p.clone().project(camera);
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
      };
    return {
      centre: proj(new THREE.Vector3(0, 0, 0)),
      marque: proj(new THREE.Vector3(0, 2.52, 0)),
      sorties: sorties.map((c) => proj(c.getPoint(1))),
    };
  }
  function raccorder() {
    const cle = camera.aspect + '|' + composition + '|' + finRaccord;
    if (cle === dernierRaccord) return;
    dernierRaccord = cle;
    const matrice = new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
      e = matrice.elements,
      cible = finRaccord * 2 - 1;
    attachements.forEach((a, i) => {
      const y = (1 - i) * 1.3,
        x = (e[12] + e[4] * y - cible * (e[15] + e[7] * y)) / (cible * e[3] - e[0]);
      a.courbe.points[1].set(x, y, 0);
      a.courbe.updateArcLengths();
      for (const [m, rayon] of [
        [a.solide, a.rayon],
        [a.halo, a.rayon * 4.5],
      ]) {
        m.geometry.dispose();
        m.geometry = new THREE.TubeGeometry(a.courbe, 72, rayon, 6, false);
      }
    });
  }
  function teinter() {
    attachements.forEach((a, i) => {
      const couleur =
        etats[i] === 'attente'
          ? '#55422f'
          : etats[i] === 'absent'
            ? '#716153'
            : etats[i] === 'erreur'
              ? '#e59b70'
              : couleurs[i];
      for (const m of [a.solide, a.halo])
        m.material.uniforms.couleur.value
          .set(couleur)
          .multiplyScalar(survol === i ? 2.2 : survol === -1 ? 1 : 0.55);
    });
  }
  function taille() {
    const r = hote.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio, 1.25), [1, 1.4, 1.6][qualite]));
    renderer.setSize(r.width, r.height, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(r.width, r.height);
    camera.aspect = r.width / r.height;
    poserCamera();
    raccorder();
    render();
  }
  function update() {
    uniforms.temps.value = temps;
    uniforms.sequence.value = mode === 'sequence' ? 1 : 0;
    uniforms.energie.value = intensite === 'douce' ? 0.86 : 1.3;
    const cycle = (temps * 0.19) % 1,
      phase = cycle < 0.333 ? 0 : cycle < 0.666 ? 1 : 2;
    uniforms.phase.value = phase;
    const chaleur =
      mode === 'sequence'
        ? Math.exp(-Math.pow((cycle - 0.5) / 0.15, 2))
        : 0.45 + Math.sin(temps * 1.3) * 0.08;
    coeur.intensity = (0.2 + chaleur * 0.45) * uniforms.energie.value;
    halo.material.opacity = (0.035 + chaleur * 0.025) * uniforms.energie.value;
    caustique.material.opacity = 0.18 + chaleur * 0.07;
    peau.uniforms.force.value = 0.035 + chaleur * 0.008;
    cle.position.z = 5 + Math.sin(temps * 0.25) * 1.7;
    balayage.position.set(
      5,
      3.5 + Math.sin(temps * 0.24) * 1.6,
      5.5 + Math.cos(temps * 0.19) * 1.2,
    );
    scene.environmentRotation.y = Math.sin(temps * 0.16) * 0.055;
    poserCamera();
    for (let i = 0; i < 21; i++) {
      const sortie = i >= 18,
        u = (temps * 0.2 + i * 0.147) % 1;
      positionPhoton.position.copy((sortie ? sorties[i - 18] : chemins[i]).getPoint(u));
      if (!sortie) positionPhoton.position.x += (uniforms.debut.value + 5.1) * (1 - u);
      const allume =
        (mode === 'continu' || (sortie ? phase === 2 : phase === 0)) &&
        (!sortie || !['attente', 'absent'].includes(etats[i - 18]));
      positionPhoton.scale.setScalar(allume ? (sortie ? 0.85 : 0.55) : 0);
      positionPhoton.updateMatrix();
      photons.setMatrixAt(i, positionPhoton.matrix);
    }
    photons.instanceMatrix.needsUpdate = true;
    const signal = phase + '-' + mode + '-' + actif + '-' + reference;
    if (signal !== dernierSignal || frames % 60 === 0) {
      dernierSignal = signal;
      signaler({ phase, mode, actif, reference, qualite, fps });
    }
  }
  function tour(now) {
    raf = 0;
    if (!actif || !visible || reference || document.hidden || detruit) return;
    const dt = clamp((now - dernier) / 1000, 0, 0.05);
    dernier = now;
    temps += dt;
    update(dt);
    render();
    frames++;
    compte++;
    if (now - chrono > 2400) {
      fps = Math.round((compte * 1000) / (now - chrono));
      chrono = now;
      compte = 0;
      lent = fps < 25 ? lent + 1 : 0;
      if (lent >= 2 && qualite > 0) {
        qualite--;
        renderer.shadowMap.enabled = false;
        taille();
        lent = 0;
      }
    }
    raf = requestAnimationFrame(tour);
  }
  function relancer() {
    if (!raf && actif && visible && !reference && !document.hidden && !detruit) {
      dernier = performance.now();
      chrono = dernier;
      compte = 0;
      raf = requestAnimationFrame(tour);
    }
  }
  function arreter() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  const ro = new ResizeObserver(taille);
  ro.observe(hote);
  const io = new IntersectionObserver(
    (e) => {
      visible = e[0].isIntersecting;
      if (visible) relancer();
      else arreter();
    },
    { rootMargin: '60px' },
  );
  io.observe(hote);
  const changement = () => {
    if (document.hidden) arreter();
    else relancer();
  };
  document.addEventListener('visibilitychange', changement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (detruit) return;
    arreter();
    signaler({ perdu: true });
  });
  update(0.1);
  taille();
  teinter();
  relancer();
  return {
    inspection(v) {
      inspection = v;
      taille();
    },
    raccorder(fin) {
      finRaccord = fin;
      dernierRaccord = '';
      poserCamera();
      raccorder();
      render();
      return pointsEcran();
    },
    composition(v) {
      composition = v;
      dernierRaccord = '';
      taille();
      return pointsEcran();
    },
    donnees(v) {
      etats = v;
      teinter();
      render();
    },
    surligner(v) {
      survol = v;
      teinter();
      render();
    },
    projection: pointsEcran,
    pause(v) {
      actif = !v;
      if (!actif) arreter();
      else relancer();
      signaler({ phase: uniforms.phase.value, mode, actif, reference, qualite, fps });
    },
    mode(v) {
      mode = v === 'sequence' ? 'sequence' : 'continu';
      temps = 0;
      update(0.2);
      render();
    },
    rejouer() {
      temps = 0;
      actif = true;
      reference = false;
      relancer();
    },
    angle(v) {
      angle = v;
      update(0.1);
      render();
    },
    lumiere(v) {
      intensite = v;
      update(0.1);
      render();
    },
    reference(v) {
      reference = v;
      if (v) arreter();
      else {
        render();
        relancer();
      }
    },
    instant(t) {
      temps = t;
      update(0.1);
      render();
    },
    etat() {
      return {
        actif,
        reference,
        mode,
        angle,
        intensite,
        temps,
        qualite,
        frames,
        fps,
        visible,
        mouvementReduit,
        canvas: [renderer.domElement.width, renderer.domElement.height],
        verre: {
          transmission: verre.transmission,
          ior: verre.ior,
          epaisseur: 0.92,
          courbure,
          reflets: verre.specularIntensity,
        },
        metal: { profilFerme: true, chanfreins: true, anisotropie: cuivre.anisotropy },
        eclairage: { studio: 5, balayage: true, bloom: bloom.strength },
        matiereVersion: 'optique-2',
        entrees: 18,
        sorties: 3,
        rayonsPrincipaux: 3,
        composition,
        donnees: etats,
        projection: pointsEcran(),
        cone: {
          source: [uniforms.debut.value, 0, 0],
          sourceEcran,
          rayon: 1.86,
          longueur: -0.24 - uniforms.debut.value,
          echantillons: 40,
        },
      };
    },
    detruire() {
      detruit = true;
      arreter();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', changement);
      const geometries = new Set(),
        materiaux = new Set();
      scene.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        if (o.material) materiaux.add(o.material);
      });
      geometries.forEach((g) => g.dispose());
      materiaux.forEach((m) => m.dispose());
      texture.dispose();
      haloMap.dispose();
      env.dispose();
      matieres.forEach((m) => m.dispose());
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
