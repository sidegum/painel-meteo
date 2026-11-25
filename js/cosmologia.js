// Cosmologia da aba Globo: distâncias e tempos no universo em expansão (modelo ΛCDM plano), para converter o desvio
// para o vermelho (z) medido de uma galáxia, quasar ou da radiação cósmica de fundo em lugar na cena e em textos.
//
// Parâmetros: Planck Collaboration 2018 (A&A 641, A6, tabela 2, última coluna: TT,TE,EE+lowE+lensing+BAO):
//   H0 = 67,66 km/s/Mpc, Ωm = 0,3111; radiação (fótons e 3,046 espécies de neutrinos sem massa) pela temperatura da
//   radiação cósmica de fundo, T0 = 2,7255 K (Fixsen 2009); universo plano, ΩΛ = 1 − Ωm − Ωr.
//
// Grandezas (Hogg 1999, "Distance measures in cosmology", arXiv:astro-ph/9905116):
//   E(z) = √(Ωr(1+z)⁴ + Ωm(1+z)³ + ΩΛ)
//   distância comóvel (a de hoje, "onde está agora"):    Dc = (c/H0) ∫₀ᶻ dz'/E(z')
//   tempo de viagem da luz (há quanto tempo ela saiu):    tL = (1/H0) ∫₀ᶻ dz'/((1+z')E(z'))
//   idade do universo quando a luz saiu:                   t(z) = (1/H0) ∫_z^∞ dz'/((1+z')E(z'))
//   distância de luminosidade:                             DL = (1+z) Dc
//   horizonte de partículas (borda do universo observável): Dc(z → ∞)
// As integrais são calculadas uma vez numa tabela em ln(1+z) (regra de Simpson, 6.000 passos até z = 10⁸) e
// interpoladas; o erro é menor que 0,01% contra a integração direta (test/cosmologia.test.mjs).
//
// Módulo puro (sem DOM nem Three.js): roda no navegador e no Node.

export const C_KMS = 299792.458;
export const H0 = 67.66;
export const OMEGA_M = 0.3111;
const T_CMB = 2.7255;
const H = H0 / 100;
// densidade de fótons: Ωγ h² = 2,469 × 10⁻⁵ (T0/2,7255 K)⁴; neutrinos: × (1 + 0,2271 Neff), Neff = 3,046
export const OMEGA_R = 2.469e-5 * (T_CMB / 2.7255) ** 4 * (1 + 0.2271 * 3.046) / (H * H);
export const OMEGA_L = 1 - OMEGA_M - OMEGA_R;
/** c/H0 em megaparsecs (distância de Hubble). */
export const DH_MPC = C_KMS / H0;
/** 1/H0 em bilhões de anos (1 Mpc = 3,0857 × 10¹⁹ km; 1 ano juliano = 3,15576 × 10⁷ s). */
export const TH_GANOS = 3.0856775814913673e19 / H0 / 3.15576e16;
/** Anos-luz por megaparsec (IAU 2012: parsec e ano juliano). */
export const AL_POR_MPC = 3.261563777e6;
/** Desvio para o vermelho da última dispersão (radiação cósmica de fundo), Planck 2018. */
export const Z_CMB = 1089.8;

export const E = (z) => { const a = 1 + z; return Math.sqrt(OMEGA_R * a ** 4 + OMEGA_M * a ** 3 + OMEGA_L); };

// tabela: x = ln(1+z) de 0 a ln(1+10⁸), com Dc/DH e tL/TH acumulados (Simpson em cada passo duplo)
const FD = (x) => Math.exp(x) / E(Math.expm1(x)), FT = (x) => 1 / E(Math.expm1(x));
const N = 6000, X_MAX = Math.log(1 + 1e8), DX = X_MAX / N;
const TAB_DC = new Float64Array(N + 1), TAB_TL = new Float64Array(N + 1);
(() => {
  // em x: dz = (1+z) dx, então Dc = ∫ (1+z)/E dx e tL = ∫ 1/E dx
  const fD = FD, fT = FT;
  for (let i = 1; i <= N; i++) {
    const a = (i - 1) * DX, m = a + DX / 2, b = i * DX;
    TAB_DC[i] = TAB_DC[i - 1] + DX / 6 * (fD(a) + 4 * fD(m) + fD(b));
    TAB_TL[i] = TAB_TL[i - 1] + DX / 6 * (fT(a) + 4 * fT(m) + fT(b));
  }
})();
// além de z = 10⁸ a radiação domina: o que falta de Dc é ~ DH/(√Ωr (1+z)) ≈ 10⁻⁶ DH e de tempo, menos de um dia

// interpolação cúbica de Hermite: entre dois nós, usa os valores acumulados e as derivadas exatas (o integrando)
function interpolar(tab, deriv, z) {
  if (!(z > 0)) return 0;
  const x = Math.log1p(z) / DX;
  if (x >= N) return tab[N];
  const i = Math.floor(x), t = x - i, t2 = t * t, t3 = t2 * t;
  const m0 = deriv(i * DX) * DX, m1 = deriv((i + 1) * DX) * DX;
  return (2 * t3 - 3 * t2 + 1) * tab[i] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * tab[i + 1] + (t3 - t2) * m1;
}

/** Distância comóvel (Mpc) até um objeto com desvio para o vermelho z: onde ele está hoje. */
export const distanciaComovel = (z) => DH_MPC * interpolar(TAB_DC, FD, z);
/** Tempo de viagem da luz (bilhões de anos): há quanto tempo a luz que vemos saiu do objeto. */
export const tempoDaLuz = (z) => TH_GANOS * interpolar(TAB_TL, FT, z);
/** Idade atual do universo (bilhões de anos). */
export const IDADE = TH_GANOS * TAB_TL[N];
/** Idade do universo (bilhões de anos) quando a luz com desvio z saiu. */
export const idadeEm = (z) => IDADE - tempoDaLuz(z);
/** Distância de luminosidade (Mpc). */
export const distanciaLuminosidade = (z) => (1 + z) * distanciaComovel(z);
/** Raio comóvel do universo observável (horizonte de partículas), em Mpc. */
export const HORIZONTE_MPC = DH_MPC * TAB_DC[N];
/** Distância comóvel da superfície da última dispersão (a "casca" da radiação cósmica de fundo), em Mpc. */
export const DIST_CMB_MPC = distanciaComovel(Z_CMB);

/** Desvio para o vermelho de um objeto a uma distância comóvel (Mpc); inverte distanciaComovel por bisseção. */
export function zDaDistancia(dMpc) {
  if (!(dMpc > 0)) return 0;
  if (dMpc >= HORIZONTE_MPC) return Infinity;
  let lo = 0, hi = 1e8;
  for (let i = 0; i < 200 && hi - lo > 1e-9 * (1 + lo); i++) {
    const m = lo < 1 && hi > 10 ? Math.sqrt((lo + 1e-6) * hi) : (lo + hi) / 2;
    if (distanciaComovel(m) < dMpc) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** Desvio para o vermelho a partir da velocidade radial (km/s), relativístico (para cz ≪ c, z ≈ cz/c). */
export const zDaVelocidade = (vKms) => vKms / C_KMS;

/**
 * Resumo para textos de um objeto com desvio z: distância de hoje, tempo da luz e idade do universo na partida.
 * @returns {{z:number, dcMpc:number, dcAl:number, tLuz:number, idade:number, dlMpc:number}}
 */
export function resumo(z) {
  const dcMpc = distanciaComovel(z);
  return { z, dcMpc, dcAl: dcMpc * AL_POR_MPC, tLuz: tempoDaLuz(z), idade: idadeEm(z), dlMpc: (1 + z) * dcMpc };
}
