export interface PickOption {
  id: string;
  name: string;
}

export const PROJETOS: readonly PickOption[] = [
  { id: "1", name: "FARMACIS" },
  { id: "2", name: "MEDICAMENTOS" },
  { id: "3", name: "MMH" },
  { id: "4", name: "SUPLEMENTOS" },
  { id: "5", name: "E-MARKET PLACE" },
];

/** Município 0 = TODOS: covers every destination. Kept as a valid choice. */
export const MUNICIPIOS: readonly PickOption[] = [
  { id: "0", name: "TODOS" },
  { id: "2", name: "CATAS ALTAS DA NORUEGA" },
  { id: "3", name: "LAGOA DOURADA" },
  { id: "4", name: "LAMIM" },
  { id: "5", name: "RIO ESPERA" },
  { id: "6", name: "ALFREDO VASCONCELOS" },
  { id: "8", name: "ANTÔNIO CARLOS" },
  { id: "10", name: "CAPELA NOVA" },
  { id: "11", name: "CARANAÍBA" },
  { id: "12", name: "CARANDAÍ" },
  { id: "13", name: "CIPOTÂNEA" },
  { id: "14", name: "CRISTIANO OTONI" },
  { id: "15", name: "DESTERRO DE ENTRE RIOS" },
  { id: "16", name: "DESTERRO DO MELO" },
  { id: "17", name: "ENTRE RIOS DE MINAS" },
  { id: "18", name: "IBERTIOGA" },
  { id: "19", name: "JECEABA" },
  { id: "20", name: "PAIVA" },
  { id: "21", name: "QUELUZITO" },
  { id: "22", name: "RESSAQUINHA" },
  { id: "23", name: "SANTA BÁRBARA DO TUGÚRIO" },
  { id: "24", name: "SANTA RITA DE IBITIPOCA" },
  { id: "25", name: "SANTANA DO GARAMBÉU" },
  { id: "26", name: "SENHORA DOS REMÉDIOS" },
  { id: "27", name: "SÃO BRÁS DO SUAÇUÍ" },
  { id: "28", name: "ALTO RIO DOCE" },
  { id: "29", name: "BARBACENA CAF" },
  { id: "30", name: "BARBACENA APS" },
  { id: "31", name: "BARBACENA MELHOR EM CASA" },
  { id: "32", name: "ANTÔNIO CARLOS - FARMÁCIA" },
  { id: "33", name: "ANTÔNIO CARLOS - HOSPITAL WAGNER" },
];

export const DEFAULT_PROJECT = PROJETOS[0]!.name;

/** Only the known projects get a board; anything else falls back to the default. */
export function isKnownProject(project: string): boolean {
  return PROJETOS.some((option) => option.name === project);
}
