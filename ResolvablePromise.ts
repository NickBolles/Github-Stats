/**
 * A class that wraps a promise into an instance that can be resolved at a later point in time
 *
 * This is useful when you want to start chaining off of a promise (or pass a promise to another function), but don't want to resolve the promise yet.
 * This is also helpful in async/await code to make the code flow more logically and avoid a callback to a Promise constructor
 *
 * @example <caption>Simple Example</caption>
 *    async function doSomethingWithPromise(promise) {
 *      const result = await promise;
 *      console.log(result ? "foo" : "bar");
 *      return "foobar";
 *    }
 *
 *    const myPromise = new ResolvablePromise<boolean>();
 *    const doSomething = doSomethingWithPromise(myPromise);
 *
 *    myPromise.resolve(true); // "foo" is logged to console;
 *    const result = await myPromise; // result is "true"
 *    const someResult = await doSomething; // someResult is "foobar"
 *
 * It's important to understand that each call to `await`, `.then` or `.finally` creates a separate "fork" of the promise chain. and
 * each fork should have it's own exception handling. For example:
 *
 * @example <caption>Error Handling Example</caption>
 *    const myPromise = new ResolvablePromise<bool>();
 *    myPromise.then((result) => result ? "foo" : "bar") // #1 - no catch and UnhandledPromiseRejection will be thrown (regardless of the following lines)
 *    myPromise.catch((e) => return "ignore") // #2 -catches the initial myPromise.reject to be caught
 *    myPromise
 *      .then((result) => result ? "foo" : "bar") // #3 - this .then is a "fork" of the promise, the third and needs separate error handling from #1 or #2
 *      .catch((e) => return "ignore") // catches errors from the myPromise.reject and the first .then (#3)
 */
export default class ResolvablePromise<T = unknown> implements Promise<T> {
  private readonly __promise: Promise<T>;

  resolve!: (value: T) => void;

  reject!: (reason: T) => void;

  constructor() {
    this.__promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  // eslint-disable-next-line class-methods-use-this
  get [Symbol.toStringTag]() {
    return 'ResolvablePromise';
  }

  /**
   * ToString implementation to make eslint happy (@typescript-eslint/no-base-to-string) and be more
   * declarative about expected result.
   * Object.toString uses Symbol.toStringTag to build the string result.
   * @returns "[object ResolvablePromise]"
   */
  toString(): string {
    return Object.prototype.toString.apply(this);
  }

  /**
   * Get the raw promise, useful for exposing the promise, but not allowing consumers to resolve the promise
   * @returns
   */
  toPromise(): Promise<T> {
    return this.__promise;
  }

  then: Promise<T>['then'] = (...args) => this.__promise.then(...args);

  catch: Promise<T>['catch'] = (...args) => this.__promise.catch(...args);

  finally: Promise<T>['finally'] = (...args) => this.__promise.finally(...args);
}
