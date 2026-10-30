import type { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { BadRequestError } from '../shared/errors/app-error.js';

export const validate = (schema: AnyZodObject) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({ body: req.body, query: req.query, params: req.params });
      req.body = parsed.body ?? req.body;
      req.query = parsed.query ?? req.query;
      req.params = parsed.params ?? req.params;
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
        return next(new BadRequestError(`Validation error: ${JSON.stringify(details)}`, 'VALIDATION_ERROR'));
      }
      return next(error);
    }
  };
};
