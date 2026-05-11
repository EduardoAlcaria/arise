package com.automationcenter.controller;

import com.automationcenter.dto.aws.AwsCredentialsRequest;
import com.automationcenter.entity.User;
import com.automationcenter.service.AwsService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/aws")
@RequiredArgsConstructor
public class AwsController {

    private final AwsService awsService;

    @PostMapping("/credentials")
    public ResponseEntity<Map<String, String>> saveCredentials(
            @RequestBody @Valid AwsCredentialsRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.saveCredentials(
                user.getId(), req.getAccessKeyId(), req.getSecretAccessKey(), req.getRegion()));
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.getStatus(user.getId()));
    }

    @GetMapping("/ec2/instances")
    public ResponseEntity<List<Map<String, Object>>> listInstances(
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEc2Instances(user.getId(), region));
    }

    @PostMapping("/ec2/instances/{instanceId}/start")
    public ResponseEntity<Void> startInstance(
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.startInstance(user.getId(), instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/ec2/instances/{instanceId}/stop")
    public ResponseEntity<Void> stopInstance(
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.stopInstance(user.getId(), instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/ec2/instances/{instanceId}")
    public ResponseEntity<Void> terminateInstance(
            @PathVariable String instanceId,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        awsService.terminateInstance(user.getId(), instanceId, region);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/s3/buckets")
    public ResponseEntity<List<Map<String, Object>>> listBuckets(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listS3Buckets(user.getId()));
    }

    @GetMapping("/ecs/clusters")
    public ResponseEntity<List<Map<String, Object>>> listClusters(
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEcsClusters(user.getId(), region));
    }

    @GetMapping("/ecs/clusters/{clusterArn}/services")
    public ResponseEntity<List<Map<String, Object>>> listServices(
            @PathVariable String clusterArn,
            @RequestParam(required = false) String region,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(awsService.listEcsServices(user.getId(), clusterArn, region));
    }
}
