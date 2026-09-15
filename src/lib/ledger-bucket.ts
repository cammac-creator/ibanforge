import { hashIp } from './stats.js';
import { normalizeIpForGuard } from './key-creation-guard.js';

/**
 * La clé de registre d'une SOURCE, pour les trois franchises gratuites.
 *
 * Un seul endroit pour les deux portes, exprès : la spec décrivait « le même
 * geste, mot pour mot » dans le middleware REST et dans la route MCP, et deux
 * copies d'un geste de sécurité sont deux occasions d'en oublier une. Laisser
 * une seule porte non gardée suffit à rouvrir le trou.
 *
 * 🚨 Normaliser D'ABORD, hacher ENSUITE. Hacher l'adresse brute garderait chaque
 * adresse d'un même /64 IPv6 dans son propre seau, et c'est tout le défaut : un
 * abonné IPv6 se voit remettre un préfixe entier et y choisit gratuitement des
 * adresses neuves (key-creation-guard.ts:45-60, SEC-05 du 01/09/2026). Un seul
 * /64 routé donnerait donc un nombre non borné de franchises ET un nombre non
 * borné de lignes dans le fichier qui porte les clés API. Replier sur le /64
 * avant de hacher donne un seau durable par abonné.
 *
 * Le prix payé — plusieurs abonnés d'un même /64 partagent une franchise — est
 * celui que la porte des créations de clés paie depuis le 01/09, et c'est le bon
 * prix : sans lui, le plafond ne compte rien.
 *
 * Le hachage, lui, est la règle du fichier : toute adresse persistée dans
 * stats.sqlite y est hachée avec le sel du service (request_log.ip_hash,
 * key_creations.ip_hash), et rien ici n'a besoin de l'adresse en clair — la
 * table n'est lue que par sa clé complète ou par une plage sur le jour. Le sel
 * vient de l'environnement (IP_HASH_SECRET, la production refuse de démarrer
 * sans lui), donc deux démarrages successifs produisent le même seau : c'est la
 * condition sans laquelle il ne fallait PAS hacher, puisqu'un sel tiré par
 * processus rendrait sa franchise à tout le monde à chaque redéploiement, sans
 * qu'aucun test hermétique ne le voie.
 *
 * 🚨 `hashIp` renvoie `string | null` : null pour une adresse vide ET pour le
 * littéral 'unknown'. Interpoler sans garde compilerait et produirait la chaîne
 * « rest:null » — un seau DURABLE partagé par tous les appelants qu'on ne sait
 * pas placer, c'est-à-dire exactement le verrou d'une journée entière que le
 * seau `unknown`, gardé en mémoire, existe pour éviter. La garde n'est pas
 * optionnelle.
 *
 * Effet de bord utile : la clé est de largeur fixe (16 caractères hexadécimaux),
 * donc une ligne du registre fait 77 octets calculés et non estimés.
 */
export function ledgerBucket(ip: string, namespace: 'rest:' | 'init:' | ''): string {
  if (ip === 'unknown') return `${namespace}unknown`;
  const source = hashIp(normalizeIpForGuard(ip));
  return source ? `${namespace}${source}` : `${namespace}unknown`;
}
