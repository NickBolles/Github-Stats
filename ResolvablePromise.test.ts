import ResolvablePromise from './ResolvablePromise';
import { delay } from './utilities';

describe('ResolvablePromise', () => {
  it('should resolve correctly', async () => {
    const promise = new ResolvablePromise();
    const resolveSpy = jest.fn();
    const rejectSpy = jest.fn().mockReturnValue(undefined);
    const finallySpy = jest.fn();
    promise.then(resolveSpy);
    promise.catch(rejectSpy);
    promise.finally(finallySpy);

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(rejectSpy).not.toHaveBeenCalled();
    expect(finallySpy).not.toHaveBeenCalled();

    promise.resolve('foo');

    await delay(1);
    expect(resolveSpy).toHaveBeenCalledWith('foo');
    expect(rejectSpy).not.toHaveBeenCalled();
    expect(finallySpy).toHaveBeenCalled();
  });

  it('should reject correctly', async () => {
    const resolveSpy = jest.fn();
    const rejectSpy1 = jest.fn().mockReturnValue(undefined);
    const rejectSpy2 = jest.fn().mockReturnValue(undefined);
    const rejectSpy3 = jest.fn().mockReturnValue(undefined);
    const finallySpy = jest.fn();

    try {
      const promise = new ResolvablePromise();
      promise.then(resolveSpy).catch(rejectSpy1);
      promise.catch(rejectSpy2);
      promise.catch(rejectSpy3).finally(finallySpy);

      expect(resolveSpy).not.toHaveBeenCalled();
      expect(rejectSpy1).not.toHaveBeenCalled();
      expect(rejectSpy2).not.toHaveBeenCalled();
      expect(rejectSpy3).not.toHaveBeenCalled();
      expect(finallySpy).not.toHaveBeenCalled();

      promise.reject('foobar');

      await delay(1);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(rejectSpy1).toHaveBeenCalledWith('foobar');
      expect(rejectSpy2).toHaveBeenCalledWith('foobar');
      expect(rejectSpy3).toHaveBeenCalledWith('foobar');
      expect(finallySpy).toHaveBeenCalled();
    } catch (e) {
      throw 'ResolvablePromise.reject did not handle rejection and was caught by test';
    }
  });

  it('should invoke .then onrejected callback', async () => {
    const promise = new ResolvablePromise();
    const resolveSpy = jest.fn();
    const rejectSpy = jest.fn();
    promise.then(resolveSpy, rejectSpy);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(rejectSpy).not.toHaveBeenCalled();
    promise.reject('foo');

    await delay(1);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(rejectSpy).toHaveBeenCalledWith('foo');
  });

  it('should resolve in the correct order', async () => {
    async function doSomethingWithPromise(_promise) {
      await _promise;
      // console.log(result ? 'foo' : 'bar');
      return 'foobar';
    }

    const myPromise = new ResolvablePromise<boolean>();
    const doSomething = doSomethingWithPromise(myPromise);

    myPromise.resolve(true); // "foo" is logged to console;
    const result = await myPromise; // result is "true"
    expect(result).toEqual(true);
    const someResult = await doSomething; // someResult is "foobar"
    expect(someResult).toEqual('foobar');
  });

  it('should stringify correctly', () => {
    const promise = new ResolvablePromise();
    expect(`${promise}`).toEqual('[object ResolvablePromise]');
  });

  describe('toPromise()', () => {
    it('should resolve correctly', async () => {
      const resolvablePromise = new ResolvablePromise();
      const promise = resolvablePromise.toPromise();
      const resolveSpy = jest.fn();
      const rejectSpy = jest.fn().mockReturnValue(undefined);
      const finallySpy = jest.fn();
      promise.then(resolveSpy);
      promise.catch(rejectSpy);
      promise.finally(finallySpy);

      expect(resolveSpy).not.toHaveBeenCalled();
      expect(rejectSpy).not.toHaveBeenCalled();
      expect(finallySpy).not.toHaveBeenCalled();

      expect(promise).not.toHaveProperty('resolve');
      expect(promise).toBeInstanceOf(Promise);
      resolvablePromise.resolve('foo');

      await delay(1);
      expect(resolveSpy).toHaveBeenCalledWith('foo');
      expect(rejectSpy).not.toHaveBeenCalled();
      expect(finallySpy).toHaveBeenCalled();
    });
  });
});
