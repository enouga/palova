# Palova — Stratégie anti-clonage & valorisation

> Note de stratégie — 2026-07-17.
> Comment protéger Palova contre le clonage, et comment en faire une application vendable qui rapporte de l'argent dans le temps.

---

## 1. La vérité sur le clonage

Réalité à accepter d'emblée : **le code ne se protège quasiment pas, et ce n'est pas grave**. Playtomic, Gestion Sports, Doinsport, Eversports existent déjà — Palova est elle-même entrée sur un marché « déjà cloné ». N'importe quelle équipe motivée peut refaire une appli de réservation de padel en 6 à 12 mois. Ce qui est protégeable et ce qui fait la valeur, ce n'est pas le code : c'est tout le reste.

### 1.1 Ce qu'on peut verrouiller juridiquement (concret, pas cher)

| Action | Coût | Pourquoi |
|---|---|---|
| **Déposer la marque « Palova » à l'INPI** (classes 42 SaaS + 41 sport + 9 appli, la 35 est optionnelle) | 190 € la 1ʳᵉ classe + 40 €/classe suppl. → **270 € pour 3 classes** (310 € avec la 35) ; renouvellement à 10 ans : 290 € + 40 €/classe | LA protection qui compte : un cloneur peut refaire le produit, il ne peut pas s'appeler Palova ni s'en approcher. Si l'Espagne se confirme → dépôt européen EUIPO (à partir de ~850 €) directement. |
| **Créer une société** (SASU probablement) et **lui céder la propriété intellectuelle du code** par un acte écrit | Frais de création | Aujourd'hui le code appartient à Eric à titre personnel (droit d'auteur automatique, aucune formalité). Pour vendre un jour, l'acheteur voudra une société qui possède proprement son actif. **Déclencheur = le premier club payant, pas maintenant** (voir 1.2). |
| **Garder le repo privé** + tout le métier côté serveur | 0 € (déjà fait) | L'architecture actuelle protège déjà : pricing, quotas, Glicko, billing, anti-double-résa vivent dans le backend. Un cloneur qui inspecte le frontend ne voit rien de la logique. |
| **CGU/CGV solides** pour les clubs | Rédaction | Clause de propriété des données + non-rétro-ingénierie. Symbolique contre un vrai cloneur, mais nécessaire pour vendre. |
| **Domaines et réseaux sociaux au nom de la société** (palova.fr, palova.app) | ~0 € | Actifs à transférer proprement dans la structure. |

### 1.2 Timing de la société : pas maintenant, mais pas « juste avant la vente »

La société peut attendre — mais **la vraie échéance n'est pas la vente, c'est le premier club qui paie** :

- **Avec zéro revenu (aujourd'hui)** : rien ne presse. Le code appartient à Eric automatiquement, la cession à une société peut se faire n'importe quand par acte écrit.
- **Dès le premier euro facturé** : structure obligatoire de toute façon — impossible de facturer sans SIRET (micro-entreprise au minimum), et opérer une plateforme qui gère paiements, données personnelles et messageries **sans société = responsabilité personnelle illimitée**.
- **Pourquoi ne pas attendre le dernier moment (monter la société la veille d'une vente)** :
  - *Contrats au mauvais nom* : si les clubs ont signé avec Eric en nom propre, tout doit être re-signé/repris par la société au moment de la vente. L'acheteur le voit en due diligence → levier de négociation du prix à la baisse.
  - *Fiscalité moins souple* : une société créée la veille avec un apport d'actif valorisé à la hâte attire l'attention du fisc (valorisation, requalification). Une société avec 2-3 ans d'historique propre = dossier limpide.
  - *Chaîne de propriété* : simple tant qu'Eric est seul auteur. Se complique dès qu'un tiers touche au code (freelance, associé, ami) sans contrat de cession — régulariser a posteriori est pénible.
- **Porte de sortie à connaître** : vendre **sans société du tout** est possible (vente d'actif en nom propre : code, marque, domaines, contrats), mais fiscalement moins favorable, et les acheteurs préfèrent presque toujours racheter une société (continuité des contrats clubs, du compte Stripe, de l'historique).
- **La marque INPI ne dépend pas de la société** : dépôt possible dès maintenant en nom propre (~190 €), transfert à la société plus tard sans difficulté. C'est elle qui est urgente, pas la SASU.

> ⚠️ À valider avec un expert-comptable / avocat le moment venu — ceci n'est pas un conseil juridique.

### 1.3 Ce qui protège vraiment en pratique (les vrais « moats »)

- **Le coût de sortie des clubs.** Un club qui a son fichier membres, ses abonnements, son historique de caisse, ses emails personnalisés et ses stats dans Palova ne part pas pour 10 € de moins ailleurs. Chaque feature qui ancre des données (caisse, abonnements, historique joueur, NF525 à terme) épaissit ce mur.
- **L'effet réseau à deux faces** : joueurs ↔ clubs (parties ouvertes nationales, calendrier national des tournois, amis, messagerie). Un clone démarre avec zéro joueur et zéro club — c'est ça sa vraie barrière, pas le code.
- **La vitesse d'exécution.** Palova livre des features à un rythme qu'une équipe classique ne suit pas. Un cloneur copie l'état d'il y a 6 mois, pendant que le produit avance.

---

## 2. Rendre Palova vendable et rentable dans le temps

Bonne nouvelle : **le moteur de revenus existe déjà dans le code**. Le billing SaaS par paliers de membres actifs (0/29/59/99/149 € HT, Stripe Billing, annuel −15 %) est implémenté, ainsi que Stripe Connect pour les paiements des clubs. Ce qui manque n'est pas technique, c'est l'exécution business.

### 2.1 Le revenu récurrent (MRR) est le seul chiffre qui compte

Un SaaS se vend entre **3× et 8× son revenu annuel récurrent (ARR)** selon la croissance et le churn. Feuille de route :

1. **Premiers clubs payants.** Le palier gratuit ≤ 50 membres est la porte d'entrée : signer 5-10 clubs locaux, les accompagner à la main, obtenir des témoignages. Un SaaS avec 20 clubs à 59 €/mois (14 k€ ARR) et 10 % de croissance mensuelle vaut déjà quelque chose ; le même code avec zéro client ne vaut presque rien.
2. **Deuxième source de revenu : commission sur les paiements en ligne.** Playtomic vit largement de ça. L'infra Stripe Connect permet d'ajouter des *application fees* (1-2 % sur les résas/inscriptions payées en ligne) — un revenu qui croît avec l'usage des clubs sans changer le pricing.
3. **Réduire le churn par l'ancrage.** Le contrôle d'accès Akiles (plan parké) est exactement le genre de brique qui rend le départ coûteux — un club dont les portes s'ouvrent via Palova ne résilie pas.
4. **Conformité = argument de vente ET barrière.** RGPD (suppression de compte déjà faite), et à terme la certification caisse NF525/LNE — chère et pénible, donc excellent filtre contre les petits clones.

### 2.2 Ce qu'un acheteur regardera le jour venu

À préparer dès maintenant :

- **Les métriques** : MRR, croissance, churn, coût d'acquisition d'un club. Commencer à les tracker — `/superadmin/billing` et `/superadmin/stats` en donnent déjà la moitié.
- **Une société propre** qui possède la marque, le code, les domaines, les contrats clients.
- **Un produit qui tourne sans dépendre du fondateur.** Les tests, les specs dans `docs/superpowers/` et le CLAUDE.md sont déjà un vrai actif de transmission — peu de solo-founders ont une base aussi documentée.
- **Des contrats clubs avec engagement.** L'annuel −15 % existe déjà : le pousser, c'est du churn verrouillé et du cash d'avance.

---

## 3. Les actions, dans l'ordre

**Maintenant :**
1. **Déposer la marque Palova à l'INPI** — possible en nom propre, sans société (EUIPO si ambition Espagne confirmée).
2. **Signer les premiers clubs réels** (palier gratuit comme porte d'entrée, accompagnement main dans la main, témoignages).

**Au premier club payant (déclencheur, cf. 1.2) :**
3. **Créer la structure juridique** (SASU si ambition confirmée, micro pour démarrer vite) avec cession de la propriété intellectuelle du code à la société — nécessaire de toute façon pour facturer et pour se protéger personnellement.

Le reste (commission Stripe, Akiles, NF525) découle du moment où il y a de vrais clubs qui paient.
