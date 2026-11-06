importScripts('recognition-core.js');
self.onmessage=e=>{const {id,image,options}=e.data;try{const result=FloorplanRecognition.detect(image,options);self.postMessage({id,result});}catch(error){self.postMessage({id,error:error.message});}};
