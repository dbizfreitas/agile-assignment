/**
 * Leitura e escrita em `localStorage` que nunca lançam (#109). O acesso pode
 * falhar em janela privada, com dados do site bloqueados ou cota cheia; nesses
 * casos a leitura devolve `null` e a escrita é ignorada, e a tela segue com o
 * valor padrão.
 */
export const ls = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};
