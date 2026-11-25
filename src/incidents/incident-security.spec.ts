import {safeIncidentPath,safeIncidentText,safeIncidentStack,safeIncidentVersion} from './incident-privacy';
describe('Régressions de confidentialité incidents',()=>{
  it('masque les valeurs sensibles dans les fragments JSON',()=>{const result=safeIncidentText('{"password":"privateword","api_key":"sk_privatekey","salary":713388}');for(const value of ['privateword','sk_privatekey','713388'])expect(result).not.toContain(value)});
  it('retire les jetons des routes de suivi et de récupération',()=>{expect(safeIncidentPath('/reset/verySecretAccessLink')).toBe('/reset/:id');expect(safeIncidentPath('/tracking/abcdefghijklmnopqrstuvwx')).toBe('/tracking/:id')});
  it('refuse les métadonnées version contenant du texte libre ou un chemin',()=>{for(const value of ['password=private','../private','mail@example.com','release\nsecret'])expect(safeIncidentVersion(value)).toBeUndefined();expect(safeIncidentVersion('release-2026.11')).toBe('release-2026.11')});
  it('masque les identifiants dans les URL de pile',()=>{expect(safeIncidentStack('Error\n    at run (https://user:password@host/app.js:1:2)')).not.toContain('password')});
});
