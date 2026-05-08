package com.automationcenter.service;

import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.command.CreateContainerResponse;
import com.github.dockerjava.api.command.PullImageResultCallback;
import com.github.dockerjava.api.model.*;
import com.github.dockerjava.core.DefaultDockerClientConfig;
import com.github.dockerjava.core.DockerClientConfig;
import com.github.dockerjava.core.DockerClientImpl;
import com.github.dockerjava.httpclient5.ApacheDockerHttpClient;
import com.github.dockerjava.transport.DockerHttpClient;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Service
public class DockerService {

    public DockerClient buildClient(String host) {
        DockerClientConfig config = DefaultDockerClientConfig.createDefaultConfigBuilder()
                .withDockerHost("tcp://" + host + ":2375")
                .build();
        DockerHttpClient httpClient = new ApacheDockerHttpClient.Builder()
                .dockerHost(config.getDockerHost())
                .maxConnections(100)
                .connectionTimeout(Duration.ofSeconds(30))
                .responseTimeout(Duration.ofSeconds(60))
                .build();
        return DockerClientImpl.getInstance(config, httpClient);
    }

    public void pullImage(DockerClient client, String image) throws InterruptedException {
        client.pullImageCmd(image)
                .exec(new PullImageResultCallback())
                .awaitCompletion(5, TimeUnit.MINUTES);
    }

    public String createContainer(DockerClient client, String name, String image,
                                   Integer hostPort, Integer containerPort,
                                   Map<String, String> envVars) {
        Ports portBindings = new Ports();
        if (hostPort != null && containerPort != null) {
            portBindings.bind(ExposedPort.tcp(containerPort), Ports.Binding.bindPort(hostPort));
        }

        List<String> env = envVars == null ? List.of() :
                envVars.entrySet().stream().map(e -> e.getKey() + "=" + e.getValue()).toList();

        CreateContainerResponse container = client.createContainerCmd(image)
                .withName(name)
                .withEnv(env)
                .withHostConfig(HostConfig.newHostConfig().withPortBindings(portBindings))
                .exec();
        return container.getId();
    }

    public void startContainer(DockerClient client, String containerId) {
        client.startContainerCmd(containerId).exec();
    }

    public void stopContainer(DockerClient client, String containerId) {
        client.stopContainerCmd(containerId).withTimeout(30).exec();
    }

    public void removeContainer(DockerClient client, String containerId) {
        client.removeContainerCmd(containerId).withForce(true).exec();
    }

    public String getLogs(DockerClient client, String containerId) {
        StringBuilder sb = new StringBuilder();
        try {
            client.logContainerCmd(containerId)
                    .withStdOut(true)
                    .withStdErr(true)
                    .withTail(200)
                    .exec(new com.github.dockerjava.api.async.ResultCallback.Adapter<Frame>() {
                        @Override
                        public void onNext(Frame item) {
                            sb.append(new String(item.getPayload()));
                        }
                    }).awaitCompletion(10, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return sb.toString();
    }
}
