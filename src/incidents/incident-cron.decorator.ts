import { Cron as NestCron } from '@nestjs/schedule';
import { captureIncident } from './incident-sink';
/** Same Nest scheduling metadata, name, timezone, return value and rejection semantics. */
export function IncidentCron(
  ...args: Parameters<typeof NestCron>
): MethodDecorator {
  return (target, key, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    descriptor.value = async function (...params: unknown[]) {
      const start = Date.now();
      try {
        return await original.apply(this, params);
      } catch (error) {
        const name = `${target.constructor.name}.${String(key)}`;
        captureIncident({
          source: 'CRON',
          code: 'CRON_FAILURE',
          message: `${name}: ${error instanceof Error ? error.message : 'Échec de la tâche'}`,
          stack: error instanceof Error ? error.stack : undefined,
          path: `/cron/${name}`,
          severity: /payroll|paie|cnss|backup|sauvegarde|reminder|rappel/i.test(
            name,
          )
            ? 'CRITICAL'
            : 'ERROR',
          context: { durationMs: Date.now() - start },
        });
        throw error;
      }
    };
    for (const key of Reflect.getMetadataKeys(original))
      Reflect.defineMetadata(
        key,
        Reflect.getMetadata(key, original),
        descriptor.value,
      );
    return NestCron(...args)(target, key, descriptor);
  };
}
