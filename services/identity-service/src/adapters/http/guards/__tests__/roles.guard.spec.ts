import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, ROLES_KEY } from '../roles.guard';

function buildContext(userRoles: string[] | undefined): ExecutionContext {
  const req: Record<string, unknown> = {};
  if (userRoles !== undefined) {
    req['userRoles'] = userRoles;
  }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no roles are required on the handler', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it('allows access when required roles is empty array', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it('throws ForbiddenError when user has no roles at all', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('throws ForbiddenError when user roles is empty array', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(buildContext([]))).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('throws ForbiddenError when user lacks required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(buildContext(['USER']))).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('allows when user has one of the required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN', 'OPS']);
    expect(guard.canActivate(buildContext(['OPS']))).toBe(true);
  });

  it('allows when user has all required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(guard.canActivate(buildContext(['ADMIN', 'USER']))).toBe(true);
  });

  it('uses the ROLES_KEY metadata key', () => {
    expect(ROLES_KEY).toBe('roles');
  });
});
