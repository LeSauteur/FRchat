export const REFERENCE_CATEGORIES = [
  ["reference-payments", "Оплаты и взносы"],
  ["reference-details", "Реквизиты и почты"],
  ["reference-contacts", "Контакты"],
  ["reference-offices", "Офисы и территории"],
  ["reference-instructions", "Инструкции"],
].map(([id, name]) => ({ id, name, emoji: "", retention_days: null }));
export const isReference = (post) => post.type === "reference";
