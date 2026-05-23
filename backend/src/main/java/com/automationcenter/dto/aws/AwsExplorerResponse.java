package com.automationcenter.dto.aws;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class AwsExplorerResponse {

    private String region;
    private List<VpcSummary> vpcs;
    private int lambdaCount;
    private int ecsClusterCount;
    private int s3Count;

    @Data
    @Builder
    public static class VpcSummary {
        private String vpcId;
        private String name;
        private String cidr;
        private int ec2Count;
        private int subnetCount;
    }
}
