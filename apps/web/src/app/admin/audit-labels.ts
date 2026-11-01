/** Libellés lisibles des actions d'audit ; une action inconnue s'affiche telle quelle. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login.success': 'Connexion réussie',
  'auth.login.failure': 'Connexion échouée',
  'auth.logout': 'Déconnexion',
  'auth.password.changed': 'Mot de passe modifié',
  'auth.password.reset': 'Mot de passe défini par lien',
  'auth.mfa.enabled': 'Second facteur activé',
  'auth.mfa.disabled': 'Second facteur désactivé',
  'auth.mfa.verified': 'Second facteur vérifié',
  'auth.mfa.recovery-used': 'Code de secours utilisé',
  'auth.mfa.recovery-regenerated': 'Codes de secours régénérés',
  'setup.completed': 'Installation terminée',
  'user.created': 'Utilisateur créé',
  'user.disabled': 'Utilisateur désactivé',
  'user.enabled': 'Utilisateur réactivé',
  'user.password-reset.issued': 'Lien de réinitialisation émis',
  'user.sessions.revoked': 'Sessions révoquées',
  'user.mfa.reset': 'Second facteur réinitialisé',
  'role.created': 'Rôle créé',
  'role.updated': 'Rôle modifié',
  'role.assigned': 'Rôle attribué',
  'role.revoked': 'Rôle retiré',
  'settings.updated': 'Paramètres modifiés',
  'module.activated': 'Module activé',
  'module.deactivated': 'Module désactivé',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
