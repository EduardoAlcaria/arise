package com.automationcenter.controller;

import com.automationcenter.entity.User;
import com.automationcenter.service.AwsService;
import com.automationcenter.service.AwsTopologyService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/aws/accounts/{accountId}")
@RequiredArgsConstructor
public class AwsController {

    private final AwsService awsService;
    private final AwsTopologyService awsTopologyService;

    @GetMapping("/ec2/instances")
    public ResponseEntity<List<Map<String, Object>>> listInstances(
            @PathVariable Long accountId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEc2Instances(user.getId(), accountId, region));
    }

    @PostMapping("/ec2/instances/{instanceId}/start")
    public ResponseEntity<Void> startInstance(
            @PathVariable Long accountId,
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.startInstance(user.getId(), accountId, instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/ec2/instances/{instanceId}/stop")
    public ResponseEntity<Void> stopInstance(
            @PathVariable Long accountId,
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.stopInstance(user.getId(), accountId, instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/ec2/instances/{instanceId}")
    public ResponseEntity<Void> terminateInstance(
            @PathVariable Long accountId,
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.terminateInstance(user.getId(), accountId, instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/s3/buckets")
    public ResponseEntity<List<Map<String, Object>>> listBuckets(
            @PathVariable Long accountId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listS3Buckets(user.getId(), accountId));
    }

    @GetMapping("/ecs/clusters")
    public ResponseEntity<List<Map<String, Object>>> listClusters(
            @PathVariable Long accountId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEcsClusters(user.getId(), accountId, region));
    }

    @GetMapping("/ecs/clusters/{clusterArn}/services")
    public ResponseEntity<List<Map<String, Object>>> listServices(
            @PathVariable Long accountId,
            @PathVariable String clusterArn,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEcsServices(user.getId(), accountId, clusterArn, region));
    }

    @GetMapping("/topology")
    public ResponseEntity<Map<String, Object>> getTopology(
            @PathVariable Long accountId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsTopologyService.getTopology(user.getId(), accountId, region));
    }

    @GetMapping("/traces")
    public ResponseEntity<List<Map<String, Object>>> listTraces(
            @PathVariable Long accountId,
            @RequestParam(required = false) String region,
            @RequestParam(defaultValue = "60") int minutes,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listTraces(user.getId(), accountId, region, minutes));
    }

    @GetMapping("/traces/{traceId}")
    public ResponseEntity<Map<String, Object>> getTrace(
            @PathVariable Long accountId,
            @PathVariable String traceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.getTrace(user.getId(), accountId, traceId, region));
    }
}
