import PromiseQueue from './PromiseQueue';

function isPromiseFulfilled(promise) {
  let resolved = false;
  let rejected = false;
  let onFulfilled = () => {
    resolved = true;
  };
  let onRejected = () => {
    rejected = true;
  };
  void promise.then(onFulfilled, onRejected);
  onFulfilled = null;
  onRejected = null;
  return resolved || rejected;
}

interface TestWorkerData {
  resolve: null | ((value: string) => void);
  worker: jest.Mock<Promise<string>>;
  enqueueResult: Promise<unknown>;
  isWorking: boolean;
  isResolved: boolean;
  name: string;
}

const createTestWorker = (name: string): TestWorkerData => {
  const workerData: TestWorkerData = {
    resolve: null,
    worker: null,
    enqueueResult: null,
    isWorking: false,
    isResolved: false,
    name
  };

  workerData.worker = jest.fn(() => {
    workerData.isWorking = true;
    return new Promise<string>((resolve) => {
      workerData.resolve = (v: string) => {
        workerData.isResolved = true;
        workerData.isWorking = false;
        resolve(v);
      };
    });
  });
  return workerData;
};

const assertWorkerHelper = async (
  msg: string,
  worker: TestWorkerData,
  waiting: boolean,
  complete: boolean,
  expectedResult?: string
) => {
  expect(worker.isWorking).toEqual(waiting); // `${msg}: worker ${worker.name} is working`
  if (waiting || complete) {
    expect(worker.worker).toHaveBeenCalledTimes(1); //  `${msg}: worker ${worker.name} call count`
  }
  expect(worker.isResolved).toEqual(complete); // `${msg}: worker ${worker.name} is resolved`

  expect(worker.enqueueResult).toBeInstanceOf(Promise);
  if (complete) {
    await expect(worker.enqueueResult).resolves.toBe(expectedResult); // `${msg}: worker ${worker.name}  enqueue result`
  } else {
    expect(isPromiseFulfilled(worker.enqueueResult)).toBeFalse(); // `${msg}: worker ${worker.name} enqueue result`
  }
};
const assertWorkerWaiting = (msg: string, worker: TestWorkerData) => assertWorkerHelper(msg, worker, false, false);

const assertWorkerWorking = (msg: string, worker: TestWorkerData) => assertWorkerHelper(msg, worker, true, false);

const assertWorkerComplete = (msg: string, worker: TestWorkerData, expectedResult: string) =>
  assertWorkerHelper(msg, worker, false, true, expectedResult);

describe('PromiseQueue', () => {
  it('resolves promises in order', async () => {
    const queue = new PromiseQueue();
    const worker1Data = createTestWorker('worker1');
    worker1Data.enqueueResult = queue.enqueue(worker1Data.worker);

    const worker2Data = createTestWorker('worker2');
    worker2Data.enqueueResult = queue.enqueue(worker2Data.worker);

    // only the first worker should be working now
    await assertWorkerWorking('after enqueue', worker1Data);
    await assertWorkerWaiting('after enqueue', worker2Data);

    // dequeuing should return false because only one can be active at a time
    expect(queue.dequeue()).toBeFalse(); // 'after enqueue'

    const worker1ExpectedResult = 'resolve worker 1 result';
    worker1Data.resolve(worker1ExpectedResult);

    // dequeuing should return false because worker 1 should be in progress already
    expect(queue.dequeue()).toBeFalse(); // 'after worker 1 resolved'

    await worker1Data.enqueueResult; // wait for result before continuing assertions
    await assertWorkerComplete('after worker 1 resolved', worker1Data, worker1ExpectedResult);
    await assertWorkerWorking('after worker 1 resolved', worker2Data);

    const worker2ExpectedResult = 'resolve worker 2 result';
    worker2Data.resolve(worker2ExpectedResult);

    // dequeuing should return false because nothing is left in the queue
    expect(queue.dequeue()).toBeFalse();

    await worker2Data.enqueueResult; // wait for result before continuing assertions
    await assertWorkerComplete('after worker 2 resolved', worker1Data, worker1ExpectedResult);
    await assertWorkerComplete('after worker 2 resolved', worker2Data, worker2ExpectedResult);

    // Adding another entry should start it right away
    const worker3Data = createTestWorker('worker3');
    worker3Data.enqueueResult = queue.enqueue(worker3Data.worker);
    await assertWorkerComplete('after worker add worker 3', worker1Data, worker1ExpectedResult);
    await assertWorkerComplete('after worker add worker 3', worker2Data, worker2ExpectedResult);
    await assertWorkerWorking('after worker add worker 3', worker3Data);

    // Adding yet another should wait until 3 resolve before starting
    const worker4Data = createTestWorker('worker4');
    worker4Data.enqueueResult = queue.enqueue(worker4Data.worker);
    await assertWorkerComplete('after worker add worker 4', worker1Data, worker1ExpectedResult);
    await assertWorkerComplete('after worker add worker 4', worker2Data, worker2ExpectedResult);
    await assertWorkerWorking('after worker add worker 4', worker3Data);
    await assertWorkerWaiting('after worker add worker 4', worker4Data);
  });

  it('allows concurrency', async () => {
    const queue = new PromiseQueue({ concurrentLimit: 2 });
    const worker1Data = createTestWorker('worker1');
    worker1Data.enqueueResult = queue.enqueue(worker1Data.worker);

    const worker2Data = createTestWorker('worker2');
    worker2Data.enqueueResult = queue.enqueue(worker2Data.worker);

    const worker3Data = createTestWorker('worker3');
    worker3Data.enqueueResult = queue.enqueue(worker3Data.worker);

    // only the first worker should be working now
    await assertWorkerWorking('after enqueue', worker1Data);
    await assertWorkerWorking('after enqueue', worker2Data);
    await assertWorkerWaiting('after enqueue', worker3Data);

    // dequeuing should return false because only 2 can be active at a time
    expect(queue.dequeue()).toBeFalse(); // 'after enqueue'

    // resolve worker 2 before worker 1 to ensure out of order works correctly
    const worker2ExpectedResult = 'resolve worker 2 result';
    worker2Data.resolve(worker2ExpectedResult);

    // dequeuing should return false because worker 1 and 3 should be in progress immediately
    expect(queue.dequeue()).toBeFalse(); // 'after worker 2 resolved'

    await worker2Data.enqueueResult; // wait for result before continuing assertions
    await assertWorkerWorking('after worker 2 resolved', worker1Data);
    await assertWorkerComplete('after worker 2 resolved', worker2Data, worker2ExpectedResult);
    await assertWorkerWorking('after worker 2 resolved', worker3Data);

    const worker1ExpectedResult = 'resolve worker 1 result';
    worker1Data.resolve(worker1ExpectedResult);

    // dequeuing should return false because nothing is left in the queue
    expect(queue.dequeue()).toBeFalse(); // 'after worker 1 resolved'

    await worker2Data.enqueueResult; // wait for result before continuing assertions
    await assertWorkerComplete('after worker 1 resolved', worker1Data, worker1ExpectedResult);
    await assertWorkerComplete('after worker 2 resolved', worker2Data, worker2ExpectedResult);
    await assertWorkerWorking('after worker 3 resolved', worker3Data);

    // Adding another entry should start it right away
    const worker4Data = createTestWorker('worker4');
    worker4Data.enqueueResult = queue.enqueue(worker4Data.worker);
    await assertWorkerComplete('after worker add worker 4', worker1Data, worker1ExpectedResult);
    await assertWorkerComplete('after worker add worker 4', worker2Data, worker2ExpectedResult);
    await assertWorkerWorking('after worker add worker 4', worker3Data);
    await assertWorkerWorking('after worker add worker 4', worker4Data);

    // Adding yet another should wait until 3 and 4 resolve before starting
    const worker5Data = createTestWorker('worker5');
    worker5Data.enqueueResult = queue.enqueue(worker5Data.worker);
    await assertWorkerComplete('after worker add worker 5', worker1Data, worker1ExpectedResult);
    await assertWorkerComplete('after worker add worker 5', worker2Data, worker2ExpectedResult);
    await assertWorkerWorking('after worker add worker 5', worker3Data);
    await assertWorkerWorking('after worker add worker 5', worker4Data);
    await assertWorkerWaiting('after worker add worker 5', worker5Data);
  });
});
