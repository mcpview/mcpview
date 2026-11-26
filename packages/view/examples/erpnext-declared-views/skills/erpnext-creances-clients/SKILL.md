---
name: erpnext-creances-clients
description: Consulter les factures de vente en retard dans l’ERPNext connecté, retrouver une facture précise ou mesurer le montant des impayés en euros.
---

Utilise l’outil `execute` de cette connexion. Son argument `code` contient le corps d’une fonction
JavaScript asynchrone. `erp.call(nom, arguments)` effectue une lecture dans ERPNext. Pour présenter
une réponse ERP, retourne directement le résultat de l’opération concernée. Pour une question de
calcul libre, tu peux retourner le résultat de ton propre calcul.

Pour consulter les impayés, récupère les factures et leurs soldes ouverts. `data` contient les
lignes retournées.

```js
return await erp.call("erpnext_doc_list", {
  doctype: "Sales Invoice",
  fields: ["name", "customer", "outstanding_amount", "due_date", "status"],
  filters: [["status", "=", "Overdue"]],
  limit: 20,
});
```

Pour ouvrir une facture, utilise l’identifiant fourni par l’utilisateur ou le champ `name` de la
ligne sélectionnée. Pour retrouver le plus gros impayé parmi les factures lues, compare leurs
`outstanding_amount`, puis ouvre la facture sélectionnée dans le même programme. Si la liste est
vide, indique-le. Si une page est pleine, utilise `offset` et `limit` pour obtenir les pages
suivantes avant de conclure sur l’ensemble des factures.

```js
return await erp.call("erpnext_sales_invoice_get", { name: invoiceName });
```

Pour le montant global des impayés en euros, utilise la mesure calculée par ERPNext. `value` donne
le nombre de factures. `secondary.value` et `secondary.currency` donnent le montant et sa devise.
`formattedValue` résume les deux.

```js
return await erp.call("erpnext_kpi_overdue", { currency: "EUR" });
```
